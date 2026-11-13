import { and, desc, eq } from "drizzle-orm";

import {
  alreadyHandedOffReply,
  emergencyReply,
  optOutReply,
  practitionerHandoffReply,
  unintelligibleVoiceReply,
} from "#/lib/assistant.ts";
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
// for a handoff to the practitioner, an opt-out, an emergency, a voice note
// nobody understood or a repeat about an open handoff's topic, and nothing for
// a handoff to reception; otherwise the
// model's own, which goes out only once the fixed checks pass and the
// clinical check finds nothing clinical in it and nothing about a patient the
// number may not hear about. A reply the check flags is held on a handoff to
// the practitioner, who sends or fixes it. A reply whose window closed before it could
// go is dropped and the conversation handed off (docs/domain/messages.md §
// When Meta limits the number). Nothing here logs a patient's words.

/** What a settled turn tells the patient: nothing, a fixed reply, or the model's. */
export type Settled =
  /** A member holds the conversation. */
  | "silent"
  | "emergency"
  /** Handed to reception, which tells the patient nothing. */
  | "handedOff"
  /** Handed to the practitioner, whose name the patient is told when it went to the appointment's. */
  | "toPractitioner"
  | "optOutAsked"
  /** Voice notes nobody could understand: the patient is asked to write. */
  | "unintelligible"
  /** Asked again about what an open handoff has: after the model's reply, the patient is told a person has it. */
  | "alreadyHandedOff"
  | "answered";

/** A settled turn: what it tells the patient, and the practitioner a handoff went to, by the name patients read. */
export interface SettledTurn {
  settled: Settled;
  practitioner: string | null;
  /**
   * A handoff to the practitioner in a turn that also made a change: the
   * model's reply about the change goes first, then the fixed one. A repeat
   * about an open handoff sends the model's reply first whether or not it did.
   */
  changed: boolean;
}

/** What a settled turn says something with: none for a member's hold or a handoff to reception. */
export type Saying = Exclude<Settled, "silent" | "handedOff">;

/** Whether the settled turn says anything to the patient. */
export function says(settled: Settled): settled is Saying {
  return settled !== "silent" && settled !== "handedOff";
}

/**
 * Whether the assistant's free-form message may go now: no member holds the
 * conversation, the window the patient's latest message opened, read now,
 * since one may have arrived during the turn, is open, and no hold of Meta's
 * (`whatsapp-limits.ts`) keeps the number from sending.
 */
export function maySend(database: Database, cloud: WhatsappCloud, conversationId: string) {
  return !isHeld(database, conversationId) && mayReach(database, cloud, conversationId);
}

/**
 * Whether a message may reach the patient now, whoever holds the
 * conversation: the window is open and no hold of Meta's keeps the number
 * from sending. The emergency reply needs no more.
 */
function mayReach(database: Database, cloud: WhatsappCloud, conversationId: string) {
  const now = Date.now();
  return (
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
async function sendReply(
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
      forPractitioner: false,
      appointmentId: turn.answered?.appointmentId ?? null,
    });
  });
}

/** The fixed reply a settled turn gets, or `null` for the model's own. */
function fixedReply(
  rules: CommunicationRules,
  turn: { settled: Saying; practitioner: string | null },
) {
  if (turn.settled === "emergency") {
    return emergencyReply(rules.formOfAddress, rules.phone && formatPhone(rules.phone));
  }
  return {
    toPractitioner: practitionerHandoffReply(rules.formOfAddress, turn.practitioner),
    optOutAsked: optOutReply(rules.formOfAddress),
    unintelligible: unintelligibleVoiceReply(rules.formOfAddress),
    alreadyHandedOff: alreadyHandedOffReply(rules.formOfAddress),
    answered: null,
  }[turn.settled];
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
 * Opens the handoff to the practitioner that holds `held.words`, unless one
 * is open already; says the handoff opened, with the practitioner it went to
 * by the name patients read, or `null` when none did.
 */
export function openHeldReply(
  database: Database,
  held: { conversationId: string; answered: TurnToSort["answered"]; words: string },
) {
  return database.transaction((tx) => {
    const open = openHandoffsOf(tx, held.conversationId);
    const wanted = {
      reason: "heldReply" as const,
      forPractitioner: true,
      appointmentId: held.answered?.appointmentId ?? null,
      heldReply: held.words,
    };
    return addsToOpen(open, wanted) ? openHandoff(tx, held.conversationId, wanted) : null;
  });
}

/**
 * Holds the reply the clinical check flagged: a handoff to the practitioner
 * with it, for them to send or fix, and the handoff's reply to the patient.
 * A handoff to the practitioner opened meanwhile has the conversation
 * already, and the reply is dropped.
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
  const text = opened && handoffReplyText(rules, opened.practitioner);
  if (text && maySend(database, cloud, conversationId)) {
    await sendReply(database, cloud, {
      conversationId,
      phone: held.phone,
      text,
      rulesVersion: rules.version,
    });
  }
}

/**
 * What a settled turn would say: its fixed reply, or the model's words, once
 * the fixed checks pass, or `null` when they do not.
 */
export function replyTexts(turn: {
  settled: Saying;
  practitioner: string | null;
  reply: string;
  rules: CommunicationRules;
}) {
  const { rules } = turn;
  const fixed = fixedReply(rules, turn);
  const words = checkReply(fixed ?? turn.reply);
  if (!words.ok) {
    return null;
  }
  return { fixed, text: words.text };
}

/** The fixed reply to a handoff to the practitioner, as the patient reads it; `null` when the fixed checks fail. */
export function handoffReplyText(rules: CommunicationRules, practitioner: string | null) {
  const checked = checkReply(practitionerHandoffReply(rules.formOfAddress, practitioner));
  return checked.ok ? checked.text : null;
}

/**
 * Sends the model's `text` once the fixed checks and the clinical check pass
 * it and `mayReply` still holds; says whether it went.
 */
async function sendCheckedReply(
  database: Database,
  cloud: WhatsappCloud,
  model: AssistantModel,
  turn: {
    conversationId: string;
    phone: string;
    patients: string[];
    text: string;
    rules: CommunicationRules;
    proposed: boolean;
    mayReply: () => boolean;
  },
) {
  const checked = checkReply(turn.text);
  if (!checked.ok || !turn.mayReply()) {
    return false;
  }
  const request = {
    conversationId: turn.conversationId,
    reply: checked.text,
    patients: turn.patients,
  };
  if (await clinicalCheckHolds(database, model, request, false)) {
    return false;
  }
  const reply = {
    conversationId: turn.conversationId,
    phone: turn.phone,
    text: checked.text,
    rulesVersion: turn.rules.version,
    whole: turn.proposed,
  };
  return sendReply(database, cloud, reply, turn.mayReply);
}

/**
 * Whether the model's reply goes before the turn's fixed one: about the
 * change a turn handed to the practitioner also made, and on a repeat about
 * an open handoff, about any new request the turn answered.
 */
export function repliesFirst(turn: { settled: Saying; changed?: boolean }) {
  return turn.settled === "alreadyHandedOff" || (turn.settled === "toPractitioner" && turn.changed);
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
    settled: Saying;
    practitioner: string | null;
    /** The turn also made a change, which the model's reply states before a handoff's fixed reply. */
    changed?: boolean;
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
  const { fixed, text } = texts;
  const reply = {
    conversationId,
    phone: turn.phone,
    text,
    rulesVersion: rules.version,
    whole: turn.proposed,
    urgent: turn.settled === "emergency",
  };
  if (fixed && repliesFirst(turn)) {
    // The easy part of a mixed burst is answered before the part a person
    // has: the model's words about it, checked, and a reply the check holds
    // is dropped, since a person has the conversation already.
    await sendCheckedReply(database, cloud, model, { ...turn, text: turn.reply });
  }
  if (fixed) {
    // The fixed replies say nothing the turn read, so a newer message or a
    // changed appointment does not hold them. The emergency reply goes though
    // a member holds the conversation.
    const mayGo =
      turn.settled === "emergency"
        ? () => mayReach(database, cloud, conversationId)
        : () => maySend(database, cloud, conversationId);
    if (!mayGo() || !(await sendReply(database, cloud, reply, mayGo))) {
      handOffClosed(database, turn);
    }
    return;
  }
  if (!turn.mayReply()) {
    handOffClosed(database, turn);
    return;
  }
  const request = { conversationId, reply: text, patients: turn.patients };
  if (await clinicalCheckHolds(database, model, request, false)) {
    await holdReply(database, cloud, { ...turn, words: text });
  } else if (!(await sendReply(database, cloud, reply, turn.mayReply))) {
    // Read again after each typing pause: a message or a change may have come
    // while the check ran or the reply typed.
    handOffClosed(database, turn);
  }
}
