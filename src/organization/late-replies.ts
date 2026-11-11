import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import { lateReplyChanceMs, lateReplyReferenceSchema } from "#/lib/conversation-holds.ts";
import type { LateReplyReference, LateReplyState } from "#/lib/conversation-holds.ts";
import { isWindowOpen } from "#/lib/conversation-window.ts";
import { eventKindTemplates } from "#/lib/outbox.ts";
import { fillTemplate } from "#/lib/template-filling.ts";
import type { OutboxDropReason } from "#/lib/outbox.ts";

import { recordAudit } from "#/organization/audit.ts";
import { organizationName } from "#/organization/members.ts";
import type { Database, Writer } from "#/organization/database.ts";
import type { WhatsappCloud } from "#/organization/graph-api.ts";
import type { Acting } from "#/organization/members.ts";
import { notify } from "#/organization/notifications.ts";
import { settleReply } from "#/organization/personal-replies.ts";
import { member, patient } from "#/organization/schema.ts";
import {
  conversation,
  lateReply,
  outboxMessage,
  whatsappMessage,
} from "#/organization/whatsapp-schema.ts";
import { activeHold, holdOnRefusal } from "#/organization/whatsapp-limits.ts";
import { approvedVersion } from "#/organization/whatsapp-templates.ts";
import {
  lastIncomingAt,
  patientsReachedAt,
  whileSending,
} from "#/organization/whatsapp-messages.ts";

// A person's reply written after the conversation's window closed
// (docs/domain/assistant.md § Handoff): stored, and the patient gets the
// reopen template, `reabrir_conversacion`, through the outbox. The reply goes
// as its writer wrote it once the patient writes again, whether or not the
// template went first. The replies written before the patient answers wait
// behind the same template. If the patient has not answered within
// `lateReplyChanceMs` of the reply, or of the template when it went later, or
// the template could not go, the writer is told the reply was not delivered.
// Until the patient answers, its writer may withdraw it. The reply itself never goes into the template.

/**
 * The first names of the patients `phone` reaches who accept WhatsApp, as the
 * reopen template greets them; `null` when there is none to send it to.
 */
function greetedAt(tx: Writer, phone: string) {
  const ids = patientsReachedAt(tx, phone).map((one) => one.id);
  if (ids.length === 0) {
    return null;
  }
  const names = tx
    .select({ firstName: patient.firstName, chosenName: patient.chosenName })
    .from(patient)
    .where(and(inArray(patient.id, ids), eq(patient.whatsappConsent, true)))
    .orderBy(asc(patient.firstName))
    .all()
    .map((one) => one.chosenName ?? one.firstName);
  if (names.length <= 1) {
    return names[0] ?? null;
  }
  return `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`;
}

/**
 * Stores `reply`, written by `writer` after the window of its conversation
 * closed, behind the reopen template: the one already waiting for the
 * patient's answer, or a new one queued now. Refused, storing nothing, when
 * no patient the number reaches accepts WhatsApp, so no template may go.
 */
export function queueLateReply(
  database: Database,
  writer: { userId: string; keepsRecords: boolean },
  reply: { conversationId: string; phone: string; text: string },
) {
  const { conversationId } = reply;
  return database.transaction((tx) => {
    if (!approvedVersion(database, eventKindTemplates.reopenConversation)) {
      return { ok: false as const, reason: "noReopenTemplate" as const };
    }
    if (!greetedAt(tx, reply.phone)) {
      return { ok: false as const, reason: "cannotReopen" as const };
    }
    // A reply joins the template an earlier reply still waits behind, keeping its own chance (`chanceEndsAt`).
    const waiting = tx
      .select({ reopenId: lateReply.reopenId })
      .from(lateReply)
      .innerJoin(outboxMessage, eq(outboxMessage.id, lateReply.reopenId))
      .where(
        and(
          eq(lateReply.conversationId, conversationId),
          eq(lateReply.state, "waiting"),
          inArray(outboxMessage.state, ["queued", "sent"]),
        ),
      )
      .get();
    const reopenId =
      waiting?.reopenId ??
      tx
        .insert(outboxMessage)
        .values({
          kind: "reopenConversation",
          templateId: eventKindTemplates.reopenConversation,
          conversationId,
          dueAt: Date.now(),
        })
        .returning({ id: outboxMessage.id })
        .get().id;
    tx.insert(lateReply)
      .values({
        conversationId,
        writtenBy: writer.userId,
        text: reply.text,
        keepsRecords: writer.keepsRecords,
        patientIds: reachedIds(tx, reply.phone),
        reopenId,
      })
      .run();
    return { ok: true as const };
  });
}

/** The patients `phone` reaches now, by id. */
function reachedIds(tx: Writer, phone: string) {
  return patientsReachedAt(tx, phone).map((one) => one.id);
}

/**
 * The queued reopen template `outboxId` as it would go now (`outbox.ts`): to
 * its conversation's number, greeting the patients who accept WhatsApp;
 * dropped when the patient wrote meanwhile, so the replies go without it, or
 * when no patient is left to send it to. `null` once it is not queued.
 */
export function reopenToSend(
  database: Database,
  outboxId: string,
): { drop: OutboxDropReason } | { drop: null; to: string; paciente: string } | null {
  const queued = database
    .select({ conversationId: conversation.id, phone: conversation.phone })
    .from(outboxMessage)
    .innerJoin(conversation, eq(conversation.id, outboxMessage.conversationId))
    .where(and(eq(outboxMessage.id, outboxId), eq(outboxMessage.state, "queued")))
    .get();
  if (!queued) {
    return null;
  }
  if (isWindowOpen(lastIncomingAt(database, queued.conversationId), Date.now())) {
    return { drop: "answered" };
  }
  const paciente = greetedAt(database, queued.phone);
  return paciente ? { drop: null, to: queued.phone, paciente } : { drop: "noConsent" };
}

/** The reopen template of `conversationId` not sent yet, as the patient will read it, for the inbox. */
export interface QueuedReopen {
  id: string;
  queuedAt: number;
  text: string;
}

/**
 * The reopen template `conversationId`'s late replies wait behind while it is
 * queued, filled as it would go now; `null` once it went, or when it would
 * be dropped instead (`reopenToSend`). Sent, it is one of the messages.
 */
export function queuedReopenShown(database: Database, conversationId: string): QueuedReopen | null {
  const queued = database
    .select({ id: outboxMessage.id, queuedAt: outboxMessage.createdAt })
    .from(outboxMessage)
    .where(
      and(
        eq(outboxMessage.conversationId, conversationId),
        eq(outboxMessage.kind, "reopenConversation"),
        eq(outboxMessage.state, "queued"),
      ),
    )
    .get();
  const toSend = queued && reopenToSend(database, queued.id);
  const version = approvedVersion(database, eventKindTemplates.reopenConversation);
  if (!queued || !toSend || toSend.drop || !version) {
    return null;
  }
  return {
    ...queued,
    text: fillTemplate(version.body, {
      paciente: toSend.paciente,
      organizacion: organizationName(database),
    }).text,
  };
}

/** Every late reply still waiting, oldest first, with its template's progress. */
function waitingReplies(database: Database) {
  return database
    .select({
      id: lateReply.id,
      conversationId: lateReply.conversationId,
      phone: conversation.phone,
      writtenBy: lateReply.writtenBy,
      text: lateReply.text,
      keepsRecords: lateReply.keepsRecords,
      patientIds: lateReply.patientIds,
      createdAt: lateReply.createdAt,
      reopenId: lateReply.reopenId,
      reopenState: outboxMessage.state,
      reopenSentAt: whatsappMessage.sentAt,
    })
    .from(lateReply)
    .innerJoin(conversation, eq(conversation.id, lateReply.conversationId))
    .innerJoin(outboxMessage, eq(outboxMessage.id, lateReply.reopenId))
    .leftJoin(whatsappMessage, eq(whatsappMessage.id, outboxMessage.whatsappMessageId))
    .where(eq(lateReply.state, "waiting"))
    .orderBy(asc(lateReply.createdAt), asc(sql`${lateReply}.rowid`))
    .all();
}

type Waiting = ReturnType<typeof waitingReplies>[number];

/**
 * When `waiting` stops waiting for the patient without an answer: its
 * chance after it was written, or after its template went if that was later,
 * so a reply joining an older template still gets the whole of it; a
 * template that cannot go (Meta paused it, or the number is held) waits out
 * the same chance. At once when the template was dropped or failed.
 */
function chanceEndsAt(waiting: Waiting) {
  if (waiting.reopenState === "dropped" || waiting.reopenState === "failed") {
    return Date.now();
  }
  return Math.max(waiting.reopenSentAt ?? 0, waiting.createdAt) + lateReplyChanceMs;
}

/**
 * When the object's alarm should next settle a late reply: at once for one
 * the patient answered, while the number may send (when a hold of Meta's ends,
 * if it ends by time); otherwise when its template's chance ends.
 */
export function nextLateReplyAlarm(database: Database, cloud: WhatsappCloud): number | null {
  const now = Date.now();
  const due = waitingReplies(database).map((one) => {
    if (!isWindowOpen(lastIncomingAt(database, one.conversationId), now)) {
      return chanceEndsAt(one);
    }
    if (cloud.missingSetting()) {
      return null;
    }
    const hold = activeHold(database, now);
    return hold ? hold.until : now;
  });
  const times = due.filter((at) => at !== null);
  return times.length > 0 ? Math.min(...times) : null;
}

/** Marks `waiting` not delivered and tells its writer, once; a template it alone waited behind is dropped. */
function notDelivered(database: Database, waiting: Waiting) {
  database.transaction((tx) => {
    dropUnneededReopen(tx, waiting, "replyNotDelivered");
    const marked = tx
      .update(lateReply)
      .set({ state: "notDelivered" })
      .where(and(eq(lateReply.id, waiting.id), eq(lateReply.state, "waiting")))
      .returning({ id: lateReply.id })
      .get();
    if (marked) {
      notify(tx, [waiting.writtenBy], {
        kind: "replyNotDelivered",
        conversationId: waiting.conversationId,
      });
    }
  });
}

/** Drops the reopen template of `leaving` while it is queued and no other reply waits behind it. */
function dropUnneededReopen(
  tx: Writer,
  leaving: { id: string; reopenId: string },
  reason: "answered" | "replyNotDelivered" | "replyWithdrawn",
) {
  const { reopenId } = leaving;
  const stillWaiting = tx
    .select({ id: lateReply.id })
    .from(lateReply)
    .where(
      and(
        eq(lateReply.reopenId, reopenId),
        eq(lateReply.state, "waiting"),
        ne(lateReply.id, leaving.id),
      ),
    )
    .get();
  if (!stillWaiting) {
    tx.update(outboxMessage)
      .set({ state: "dropped", dropReason: reason })
      .where(and(eq(outboxMessage.id, reopenId), eq(outboxMessage.state, "queued")))
      .run();
  }
}

/**
 * Withdraws `acting`'s own late reply while it waits for the patient, who has
 * not answered: it never goes, and a template it alone waited behind that has
 * not gone is dropped. Once the patient answered, the alarm sends it, so it
 * stays; another member's reply is not found.
 */
export function withdrawOwnLateReply(
  database: Database,
  acting: Acting,
  input: LateReplyReference,
) {
  const parsed = lateReplyReferenceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, reason: "invalidInput" as const };
  }
  return database.transaction((tx) => {
    const found = tx
      .select({
        id: lateReply.id,
        conversationId: lateReply.conversationId,
        state: lateReply.state,
        reopenId: lateReply.reopenId,
      })
      .from(lateReply)
      .where(and(eq(lateReply.id, parsed.data.lateReplyId), eq(lateReply.writtenBy, acting.userId)))
      .get();
    if (!found) {
      return { ok: false as const, reason: "notFound" as const };
    }
    if (found.state !== "waiting") {
      return { ok: false as const, reason: "notWaiting" as const };
    }
    if (isWindowOpen(lastIncomingAt(tx, found.conversationId), Date.now())) {
      return { ok: false as const, reason: "answered" as const };
    }
    dropUnneededReopen(tx, found, "replyWithdrawn");
    tx.update(lateReply).set({ state: "withdrawn" }).where(eq(lateReply.id, found.id)).run();
    // Its words stay out of the log, as every patient's conversation does.
    recordAudit(tx, acting.userId, {
      action: "update",
      entityType: "lateReply",
      entityId: found.id,
      patientId: null,
      before: { state: "waiting" },
      after: { state: "withdrawn" },
    });
    return { ok: true as const };
  });
}

/** Whether late reply `id` still waits: its writer may have withdrawn it while the alarm sent earlier ones. */
function stillWaiting(database: Database, id: string) {
  const current = database
    .select({ state: lateReply.state })
    .from(lateReply)
    .where(eq(lateReply.id, id))
    .get();
  return current?.state === "waiting";
}

/**
 * Sends `waiting` as its writer wrote it. A limit on the number leaves it
 * waiting for the hold to end; any other failure makes it not delivered, for
 * its writer to try again.
 */
async function deliver(database: Database, cloud: WhatsappCloud, waiting: Waiting) {
  if (!stillWaiting(database, waiting.id)) {
    return;
  }
  // A contact changed since it was written: the number may no longer hear about each patient.
  const reachedNow = new Set(reachedIds(database, waiting.phone));
  if (!waiting.patientIds.every((id) => reachedNow.has(id))) {
    notDelivered(database, waiting);
    return;
  }
  const sent = await whileSending(database, () =>
    cloud.sendText({ to: waiting.phone, text: waiting.text }),
  ).catch((error: unknown) => {
    // The error's message can carry the request, so only its class is logged.
    console.error(
      `[late-reply] send to Meta threw in conversation ${waiting.conversationId}:`,
      error instanceof Error ? error.name : typeof error,
    );
    return null;
  });
  if (!sent?.ok) {
    if (!sent || !holdOnRefusal(database, sent.metaError)) {
      notDelivered(database, waiting);
    }
    return;
  }
  database.transaction((tx) => {
    const stored = settleReply(database, tx, {
      ...waiting,
      since: waiting.createdAt,
      whatsappId: sent.messageId,
      writtenAt: waiting.createdAt,
    });
    tx.update(lateReply)
      .set({ state: "delivered", whatsappMessageId: stored.id })
      .where(eq(lateReply.id, waiting.id))
      .run();
    dropUnneededReopen(tx, waiting, "answered");
  });
}

/**
 * Settles every late reply that is due, oldest first: the object's alarm.
 * One the patient answered goes; one whose template's chance ended without
 * an answer is not delivered.
 */
export async function settleLateReplies(database: Database, cloud: WhatsappCloud) {
  for (const one of waitingReplies(database)) {
    const now = Date.now();
    if (isWindowOpen(lastIncomingAt(database, one.conversationId), now)) {
      if (!cloud.missingSetting() && !activeHold(database, now)) {
        await deliver(database, cloud, one);
      }
      continue;
    }
    const endsAt = chanceEndsAt(one);
    if (endsAt !== null && endsAt <= now) {
      notDelivered(database, one);
    }
  }
}

/** A late reply as the inbox shows it, while it waits or once it was not delivered. */
export interface ShownLateReply {
  id: string;
  /** Its writer, by name. */
  writer: string;
  writtenAt: number;
  state: Exclude<LateReplyState, "delivered" | "withdrawn">;
  /** Whether the reader wrote it, so may withdraw it while it waits. */
  mine: boolean;
  /** Its words, under its writer's name. */
  text: string;
}

/**
 * The late replies of `conversationId` not delivered, oldest first, as
 * the member `readerId` reads them: a delivered one is a message, a
 * withdrawn one is gone.
 */
export function lateRepliesShown(
  database: Database,
  conversationId: string,
  readerId: string,
): ShownLateReply[] {
  return database
    .select({
      id: lateReply.id,
      writer: member.name,
      writtenBy: lateReply.writtenBy,
      writtenAt: lateReply.createdAt,
      state: lateReply.state,
      text: lateReply.text,
    })
    .from(lateReply)
    .innerJoin(member, eq(member.userId, lateReply.writtenBy))
    .where(
      and(
        eq(lateReply.conversationId, conversationId),
        inArray(lateReply.state, ["waiting", "notDelivered"]),
      ),
    )
    .orderBy(asc(lateReply.createdAt), asc(sql`${lateReply}.rowid`))
    .all()
    .map(({ state, writtenBy, ...one }) => ({
      ...one,
      state: state === "waiting" ? "waiting" : "notDelivered",
      mine: writtenBy === readerId,
    }));
}
