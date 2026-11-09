import { and, count, eq, inArray, isNull, lt } from "drizzle-orm";

import { outboxTemplates } from "#/lib/outbox.ts";
import type { OutboxKind } from "#/lib/outbox.ts";
import { isLowerLimit } from "#/lib/whatsapp.ts";
import type { NumberHoldReason } from "#/lib/whatsapp.ts";
import type { WhatsappNumberEvent } from "#/lib/whatsapp-messages.ts";
import type { TemplateName } from "#/lib/whatsapp-templates.ts";

import type { Database, Writer } from "#/organization/database.ts";
import type { MetaError } from "#/organization/graph-api.ts";
import { notifyAdmins } from "#/organization/notifications.ts";
import {
  outboxMessage,
  whatsappConnection,
  whatsappNumberHold,
} from "#/organization/whatsapp-schema.ts";

// When Meta limits the number or a template (docs/domain/messages.md § When
// Meta limits the number): what Meta's events change, the warning every admin
// gets at once, and the hold that keeps the outbox's messages queued, with no
// attempt spent, until the number can start conversations again. What still
// goes then is the outbox's to judge, as for any message (`outbox.ts`).

/** The hold on the number at `now`, if any: one whose time has passed holds nothing. */
export function activeHold(database: Writer, now: number) {
  const hold = database.select().from(whatsappNumberHold).get();
  return hold && (hold.until === null || hold.until > now) ? hold : null;
}

/** Holds the number for `reason` until `until`, and says whether that changed the hold: Meta repeats its events. */
function hold(tx: Writer, reason: NumberHoldReason, until: number | null) {
  const current = activeHold(tx, Date.now());
  if (current?.reason === reason && current.until === until) {
    return false;
  }
  tx.insert(whatsappNumberHold)
    .values({ id: 1, reason, until })
    .onConflictDoUpdate({ target: whatsappNumberHold.id, set: { reason, until } })
    .run();
  return true;
}

/** Lifts a hold for `reason`; a hold for another reason stays. */
function lift(tx: Writer, reason: NumberHoldReason) {
  tx.delete(whatsappNumberHold).where(eq(whatsappNumberHold.reason, reason)).run();
}

/**
 * How many queued messages a limit holds: those sent as `template`, or, for
 * the number, those due before its hold ends (`until`, every one while it
 * lasts until Meta lifts it).
 */
export function waitingCount(
  tx: Writer,
  held: { template: TemplateName } | { until: number | null },
) {
  const kinds = (Object.keys(outboxTemplates) as OutboxKind[]).filter(
    (kind) => !("template" in held) || outboxTemplates[kind] === held.template,
  );
  const until = "until" in held ? held.until : null;
  const counted = tx
    .select({ count: count() })
    .from(outboxMessage)
    .where(
      and(
        eq(outboxMessage.state, "queued"),
        inArray(outboxMessage.kind, kinds),
        until === null ? undefined : lt(outboxMessage.dueAt, until),
      ),
    )
    .get();
  return counted?.count ?? 0;
}

/**
 * Applies Meta's news about the number and warns the admins of a restriction,
 * a disabled account or a lowered limit. A disabled account outranks a
 * restriction: only its reinstatement lifts it.
 */
export function storeNumberEvent(tx: Writer, event: WhatsappNumberEvent) {
  switch (event.kind) {
    case "restricted": {
      if (activeHold(tx, Date.now())?.reason === "disabled") {
        return;
      }
      if (!hold(tx, "restricted", event.until)) {
        return;
      }
      notifyAdmins(tx, {
        kind: "numberRestricted",
        until: event.until,
        waiting: waitingCount(tx, { until: event.until }),
      });
      return;
    }
    case "unrestricted":
      lift(tx, "restricted");
      return;
    case "disabled":
      if (hold(tx, "disabled", null)) {
        notifyAdmins(tx, { kind: "numberDisabled", waiting: waitingCount(tx, { until: null }) });
      }
      return;
    case "reinstated":
      lift(tx, "disabled");
      return;
    case "messagingLimit":
      storeMessagingLimit(tx, event.limit);
  }
}

/** Puts the number's new limit on its connection; a lowered one warns the admins. */
function storeMessagingLimit(tx: Writer, limit: string) {
  const connection = tx
    .select({ messagingLimit: whatsappConnection.messagingLimit })
    .from(whatsappConnection)
    .get();
  if (!connection) {
    return;
  }
  tx.update(whatsappConnection).set({ messagingLimit: limit }).run();
  if (isLowerLimit(connection.messagingLimit, limit)) {
    notifyAdmins(tx, { kind: "messagingLimitLowered", detail: limit });
  }
}

/** Meta's send errors that limit the number, not one message: a rate limit, or a block. */
const holdingErrors: Record<number, { reason: NumberHoldReason; minutes: number }> = {
  // Throughput: too many messages a second.
  130429: { reason: "rateLimited", minutes: 30 },
  // Spam rate limit: too many messages blocked or reported.
  131048: { reason: "rateLimited", minutes: 30 },
  // Temporarily blocked for a policy violation, or the account locked.
  368: { reason: "restricted", minutes: 60 },
  131031: { reason: "restricted", minutes: 60 },
};

/**
 * Holds the number when Meta refused a send for a limit on the number, and
 * says whether the refusal was one: the message then waits with no attempt
 * spent. A hold already in place, which a webhook event may have set while
 * the send waited on Meta, is kept, so the admins are warned only when a hold
 * starts.
 */
export function holdOnRefusal(database: Database, error: MetaError) {
  const holding = error.code === null ? undefined : holdingErrors[error.code];
  if (!holding) {
    return false;
  }
  const now = Date.now();
  database.transaction((tx) => {
    if (activeHold(tx, now)) {
      return;
    }
    const until = now + holding.minutes * 60_000;
    hold(tx, holding.reason, until);
    const kind = holding.reason === "rateLimited" ? "numberRateLimited" : "numberRestricted";
    notifyAdmins(tx, { kind, until, waiting: waitingCount(tx, { until }) });
  });
  return true;
}

/**
 * Ends `earlier`, the hold in place when the organization started connecting
 * a number on another account, which Meta's limits on the earlier account do
 * not reach. A hold Meta put on the new account meanwhile differs, and stays.
 */
export function endHold(tx: Writer, earlier: { reason: NumberHoldReason; until: number | null }) {
  tx.delete(whatsappNumberHold)
    .where(
      and(
        eq(whatsappNumberHold.reason, earlier.reason),
        earlier.until === null
          ? isNull(whatsappNumberHold.until)
          : eq(whatsappNumberHold.until, earlier.until),
      ),
    )
    .run();
}
