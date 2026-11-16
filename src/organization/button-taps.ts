import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { tapConfirmedReply } from "#/lib/assistant.ts";
import { readButtonPayload, tapLine } from "#/lib/button-payloads.ts";

import { changeAppointmentStatus } from "#/organization/appointment-changes.ts";
import { upcomingAppointments } from "#/organization/assistant-appointments.ts";
import { currentCommunicationRules } from "#/organization/communication-rules.ts";
import type { Database } from "#/organization/database.ts";
import type { WhatsappCloud } from "#/organization/graph-api.ts";
import { assistantActing } from "#/organization/proposals.ts";
import { reach } from "#/organization/sending.ts";
import { sendReply } from "#/organization/turn-replies.ts";
import { whatsappMessage } from "#/organization/whatsapp-schema.ts";

// A patient's tap on a template's quick-reply button (ADR-0014). Code reads
// only the payload underthing set when it sent the template, never the
// patient's words: `Sí, voy` confirms the appointment it names, while that
// appointment is still upcoming, reached by the number and at the start the
// message stated, and `Ver respuesta` needs nothing more than the late reply
// it opens the window for (`late-replies.ts`). A tap that comes alone after
// the assistant's wait is settled here, with no model call; any other goes to
// the model as the patient's words, with the message it answers.

const buttonType = "button";

/** The taps of `conversationId` as the model reads them, by message id: each with the words of the message it answers. */
export function tapLinesOf(database: Database, conversationId: string) {
  const isTap = and(
    eq(whatsappMessage.conversationId, conversationId),
    eq(whatsappMessage.type, buttonType),
  );
  const taps = database
    .select({
      id: whatsappMessage.id,
      text: whatsappMessage.text,
      repliesTo: whatsappMessage.repliesTo,
    })
    .from(whatsappMessage)
    .where(isTap)
    .all();
  const answered = alias(whatsappMessage, "answered");
  const targets = database
    .select({ whatsappId: answered.whatsappId, text: answered.text })
    .from(answered)
    .where(
      and(
        eq(answered.conversationId, conversationId),
        inArray(
          answered.whatsappId,
          database.select({ id: whatsappMessage.repliesTo }).from(whatsappMessage).where(isTap),
        ),
      ),
    )
    .all();
  const words = new Map(targets.map((target) => [target.whatsappId, target.text || null]));
  return new Map(
    taps.map((tap) => [
      tap.id,
      tapLine(tap.text ?? "", tap.repliesTo ? (words.get(tap.repliesTo) ?? null) : null),
    ]),
  );
}

/** The fixed reply a settled tap gets, or `null` for one that needs none. */
type SettledTap = { reply: string | null };

/**
 * Settles the turn's messages when they are one tap code acts on: confirms
 * the appointment `Sí, voy` names, and judges the tap. `null` when the turn
 * goes to the model instead.
 */
function settleTap(
  database: Database,
  turn: {
    conversationId: string;
    phone: string;
    unjudged: { id: string; type: string; buttonPayload: string | null }[];
  },
): SettledTap | null {
  const [tap, ...others] = turn.unjudged;
  if (!tap || others.length > 0 || tap.type !== buttonType || tap.buttonPayload === null) {
    return null;
  }
  const payload = readButtonPayload(tap.buttonPayload);
  if (!payload) {
    return null;
  }
  let reply: string | null = null;
  if (payload.kind === "confirm") {
    const upcoming = upcomingAppointments(database, turn.phone, Date.now()).find(
      (one) => one.id === payload.appointmentId,
    );
    if (!upcoming || upcoming.startsAt !== payload.startsAt) {
      return null;
    }
    if (upcoming.status === "booked") {
      const changed = changeAppointmentStatus(database, assistantActing, {
        appointmentId: upcoming.id,
        status: "confirmed",
      });
      if (!changed.ok) {
        return null;
      }
    }
    reply = tapConfirmedReply(currentCommunicationRules(database).formOfAddress);
  }
  database
    .update(whatsappMessage)
    .set({ judgement: "notForPractitioner" })
    .where(eq(whatsappMessage.id, tap.id))
    .run();
  return { reply };
}

/**
 * Answers the turn when it is one tap code acts on: its delivery, which sends
 * the fixed reply, though a member holds the conversation, since the patient
 * asked for exactly this. `null` when the turn goes to the model instead.
 */
export function answerTap(
  database: Database,
  cloud: WhatsappCloud,
  turn: Parameters<typeof settleTap>[1],
): { deliver: (() => Promise<void>) | null } | null {
  const settled = settleTap(database, turn);
  if (!settled) {
    return null;
  }
  const { reply } = settled;
  if (reply === null) {
    return { deliver: null };
  }
  const { conversationId, phone } = turn;
  const rulesVersion = currentCommunicationRules(database).version;
  return {
    deliver: async () => {
      await sendReply(
        database,
        cloud,
        { conversationId, phone, text: reply, rulesVersion, whoeverHolds: true },
        () => reach(database, cloud, { conversationId, whoeverHolds: true }).ok,
      );
    },
  };
}
