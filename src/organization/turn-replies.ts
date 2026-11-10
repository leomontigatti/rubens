import { and, desc, eq } from "drizzle-orm";

import { emergencyReply, handoffReply, optOutReply, withSignOff } from "#/lib/assistant.ts";
import { isWindowOpen } from "#/lib/conversation-window.ts";
import { formatPhone } from "#/lib/phones.ts";
import { checkReply } from "#/lib/reply-checks.ts";
import { splitReply, typingPauseOf } from "#/lib/reply-pacing.ts";

import type { AssistantModel, ModelUsage, ReplyToCheck } from "#/organization/assistant-model.ts";
import { recordModelUsage } from "#/organization/assistant-usage.ts";
import type { CommunicationRules } from "#/organization/communication-rules.ts";
import type { Database } from "#/organization/database.ts";
import type { WhatsappCloud } from "#/organization/graph-api.ts";
import { addsToOpen, openHandoff, openHandoffsOf } from "#/organization/handoffs.ts";
import type { TurnToSort } from "#/organization/turn-handoffs.ts";
import { typingPause } from "#/organization/typing-pause.ts";
import { activeHold, holdOnRefusal } from "#/organization/whatsapp-limits.ts";
import {
  isHeld,
  lastIncomingAt,
  storeOutgoing,
  whileSending,
} from "#/organization/whatsapp-messages.ts";
import { whatsappMessage } from "#/organization/whatsapp-schema.ts";

// How a settled turn of the patient assistant (`assistant.ts`) answers the
// patient (docs/domain/assistant.md § Rules it always keeps): a fixed reply
// for a handoff, an opt-out or an emergency; otherwise the model's own,
// which goes out only once the fixed checks pass and the clinical check
// finds nothing clinical in it and nothing about a patient the number may not
// hear about. A reply the check flags is held on a clinical handoff, for its
// recipients to send, fix or drop. A reply whose window closed before it could
// go is dropped and the conversation handed off (docs/domain/messages.md §
// When Meta limits the number). Nothing here logs a patient's words.

/** What a settled turn tells the patient: nothing, a fixed reply, or the model's. */
export type Settled = "silent" | "emergency" | "handedOff" | "optOutAsked" | "answered";

/**
 * Whether the assistant's free-form message may go now: no member holds the
 * conversation, the window the patient's latest message opened, read now,
 * since one may have arrived during the turn, is open, and no hold of Meta's
 * (`whatsapp-limits.ts`) keeps the number from sending.
 */
export function maySend(database: Database, cloud: WhatsappCloud, conversationId: string) {
  const now = Date.now();
  return (
    !isHeld(database, conversationId) &&
    isWindowOpen(lastIncomingAt(database, conversationId), now) &&
    !cloud.missingSetting() &&
    !activeHold(database, now)
  );
}

/**
 * Sends one message of a reply, and stores it with the rules' version it was
 * written under; says whether it went.
 */
async function sendMessage(
  database: Database,
  cloud: WhatsappCloud,
  message: { phone: string; text: string; rulesVersion: number },
) {
  // A send that did not reach Meta drops the reply, as a refusal does: the
  // patient's messages stay judged, and their next one gets a turn of its own.
  const sent = await whileSending(database, () =>
    cloud.sendText({ to: message.phone, text: message.text }),
  ).catch(() => null);
  if (!sent) {
    return false;
  }
  if (!sent.ok) {
    // A limit on the number holds the outbox too.
    holdOnRefusal(database, sent.metaError);
    return false;
  }
  database.transaction((tx) =>
    storeOutgoing(database, tx, {
      phone: message.phone,
      whatsappId: sent.messageId,
      type: "text",
      text: message.text,
      payload: JSON.stringify({ text: message.text }),
      rulesVersion: message.rulesVersion,
    }),
  );
  return true;
}

/** Marks the patient's latest message read and shows them typing; a failure only skips it. */
async function showTyping(database: Database, cloud: WhatsappCloud, conversationId: string) {
  const latest = database
    .select({ whatsappId: whatsappMessage.whatsappId })
    .from(whatsappMessage)
    .where(
      and(
        eq(whatsappMessage.conversationId, conversationId),
        eq(whatsappMessage.direction, "incoming"),
      ),
    )
    .orderBy(desc(whatsappMessage.sentAt))
    .get();
  if (latest) {
    await cloud.showTyping(latest.whatsappId).catch(() => null);
  }
}

/**
 * Sends the assistant's `text` to the conversation's number at a person's
 * pace (docs/domain/assistant.md § Pace): as up to three messages, or whole
 * when it holds a proposal, each after its typing, with no pause for an
 * emergency. `mayGo` is read again
 * after each pause, `maySend` unless the caller checks more: once it fails,
 * the rest does not go. Says whether every message went.
 */
export async function sendReply(
  database: Database,
  cloud: WhatsappCloud,
  reply: {
    conversationId: string;
    phone: string;
    text: string;
    rulesVersion: number;
    /** The reply holds a proposal, which stays whole in one message. */
    whole?: boolean;
    /** An emergency's reply, which goes without the typing pause. */
    urgent?: boolean;
  },
  mayGo = () => maySend(database, cloud, reply.conversationId),
) {
  for (const text of splitReply(reply.text, { whole: reply.whole ?? false })) {
    await showTyping(database, cloud, reply.conversationId);
    if (!reply.urgent) {
      await typingPause(typingPauseOf(text));
    }
    if (!mayGo() || !(await sendMessage(database, cloud, { ...reply, text }))) {
      return false;
    }
  }
  return true;
}

/**
 * Hands the conversation off when the reply of its turn cannot go because its
 * window closed, and no member holds it nor a handoff is open already: the
 * handoff, opened after the close, tells the patient nothing.
 */
function handOffClosed(
  database: Database,
  turn: { conversationId: string; answered: TurnToSort["answered"] },
) {
  const { conversationId } = turn;
  if (isWindowOpen(lastIncomingAt(database, conversationId), Date.now())) {
    return;
  }
  database.transaction((tx) => {
    if (isHeld(tx, conversationId) || openHandoffsOf(tx, conversationId).length > 0) {
      return;
    }
    openHandoff(tx, conversationId, {
      reason: "windowClosed",
      clinical: false,
      appointmentId: turn.answered?.appointmentId ?? null,
    });
  });
}

/** The fixed reply a settled turn gets, or `null` for the model's own. */
function fixedReply(rules: CommunicationRules, settled: Exclude<Settled, "silent">) {
  if (settled === "emergency") {
    return emergencyReply(rules.formOfAddress, rules.phone && formatPhone(rules.phone));
  }
  return {
    handedOff: handoffReply(rules.formOfAddress),
    optOutAsked: optOutReply(rules.formOfAddress),
    answered: null,
  }[settled];
}

/**
 * Whether the clinical check holds the reply: clinical, about a patient the
 * number may not hear about, or unchecked because the check failed.
 */
export async function clinicalCheckHolds(
  database: Database,
  model: AssistantModel,
  request: Omit<ReplyToCheck, "recordUsage">,
  sandbox: boolean,
) {
  const recordUsage = (used: ModelUsage) =>
    recordModelUsage(database, { ...used, purpose: "clinicalCheck", sandbox });
  const found = await model.checkReply({ ...request, recordUsage }).catch((error: unknown) => {
    // Any failure leaves the reply unchecked, so it is held. The error's
    // message can carry the reply, so only its class is logged.
    console.error(
      `[clinical-check] check failed in conversation ${request.conversationId}:`,
      error instanceof Error ? error.name : typeof error,
    );
    return null;
  });
  return !found || found.clinical || found.otherPatient;
}

/**
 * Opens the clinical handoff that holds `held.words`, unless a clinical one is
 * open already; says whether it is the conversation's only open handoff, whose
 * reply the patient then gets.
 */
export function openHeldReply(
  database: Database,
  held: { conversationId: string; answered: TurnToSort["answered"]; words: string },
) {
  return database.transaction((tx) => {
    const open = openHandoffsOf(tx, held.conversationId);
    const wanted = {
      reason: "heldReply" as const,
      clinical: true,
      appointmentId: held.answered?.appointmentId ?? null,
      heldReply: held.words,
    };
    if (!addsToOpen(open, wanted)) {
      return false;
    }
    openHandoff(tx, held.conversationId, wanted);
    return open.length === 0;
  });
}

/**
 * Holds the reply the clinical check flagged: a clinical handoff with it, for
 * its recipients to send, fix or drop, and the handoff's reply to the
 * patient. A clinical handoff opened meanwhile has the conversation already,
 * and the reply is dropped.
 */
async function holdReply(
  database: Database,
  cloud: WhatsappCloud,
  held: {
    conversationId: string;
    phone: string;
    answered: TurnToSort["answered"];
    words: string;
    rules: CommunicationRules;
  },
) {
  const { conversationId, rules } = held;
  const opened = openHeldReply(database, held);
  const text = handoffReplyText(rules);
  if (opened && text && maySend(database, cloud, conversationId)) {
    await sendReply(database, cloud, {
      conversationId,
      phone: held.phone,
      text,
      rulesVersion: rules.version,
    });
  }
}

/**
 * What a settled turn would say: its fixed reply, or the model's words; each
 * signed, once the fixed checks pass, or `null` when they do not.
 */
export function replyTexts(turn: {
  settled: Exclude<Settled, "silent">;
  reply: string;
  rules: CommunicationRules;
}) {
  const { rules } = turn;
  const fixed = fixedReply(rules, turn.settled);
  // A turn that ended on its tools has no words of its own to sign.
  const words = checkReply(fixed ?? turn.reply);
  const checked = checkReply(withSignOff(fixed ?? turn.reply, rules.signOff));
  if (!words.ok || !checked.ok) {
    return null;
  }
  return { fixed, words: words.text, checked: checked.text };
}

/** The fixed reply to a handoff, signed, as the patient reads it; `null` when the fixed checks fail. */
export function handoffReplyText(rules: CommunicationRules) {
  const checked = checkReply(withSignOff(handoffReply(rules.formOfAddress), rules.signOff));
  return checked.ok ? checked.text : null;
}

/**
 * Answers the settled turn: its fixed reply when the number may send, or the
 * model's reply once the fixed checks and the clinical check pass and
 * `mayReply` still holds, read again after the check.
 */
export async function deliverReply(
  database: Database,
  cloud: WhatsappCloud,
  model: AssistantModel,
  turn: {
    conversationId: string;
    phone: string;
    /** The first names of the patients the number may hear about. */
    patients: string[];
    answered: TurnToSort["answered"];
    settled: Exclude<Settled, "silent">;
    reply: string;
    rules: CommunicationRules;
    /** The turn proposed a change, which its reply states: it goes out whole. */
    proposed: boolean;
    /** Whether the model's reply may go now (`assistant.ts`). */
    mayReply: () => boolean;
  },
) {
  const { conversationId, rules } = turn;
  const texts = replyTexts(turn);
  if (!texts) {
    return;
  }
  const { fixed, words, checked } = texts;
  const reply = {
    conversationId,
    phone: turn.phone,
    text: checked,
    rulesVersion: rules.version,
    whole: turn.proposed,
    urgent: turn.settled === "emergency",
  };
  if (fixed) {
    // The fixed replies say nothing the turn read, so a newer message or a
    // changed appointment does not hold them: the next turn is silent after a handoff.
    if (!maySend(database, cloud, conversationId) || !(await sendReply(database, cloud, reply))) {
      handOffClosed(database, turn);
    }
    return;
  }
  if (!turn.mayReply()) {
    handOffClosed(database, turn);
    return;
  }
  // The whole text that would go, sign-off included; the held reply is the model's words alone.
  const request = { conversationId, reply: checked, patients: turn.patients };
  if (await clinicalCheckHolds(database, model, request, false)) {
    await holdReply(database, cloud, { ...turn, words });
  } else if (!(await sendReply(database, cloud, reply, turn.mayReply))) {
    // Read again after each typing pause: a message or a change may have come
    // while the check ran or the reply typed.
    handOffClosed(database, turn);
  }
}
