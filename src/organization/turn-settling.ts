import { and, eq, inArray, isNull } from "drizzle-orm";

import type { MediaType } from "#/lib/whatsapp-messages.ts";

import type { Database, Writer } from "#/organization/database.ts";
import { addsToOpen, openHandoff, openHandoffsOf } from "#/organization/handoffs.ts";
import type { HandoffWanted } from "#/organization/handoffs.ts";
import { notify } from "#/organization/notifications.ts";
import { holdForOptOut } from "#/organization/opt-out-holds.ts";
import { handoffWanted } from "#/organization/turn-handoffs.ts";
import type { Judgement, TurnToSort } from "#/organization/turn-handoffs.ts";
import type { SettledTurn } from "#/organization/turn-replies.ts";
import { conversation, handoff, whatsappMessage } from "#/organization/whatsapp-schema.ts";
import { isHeld, patientsReachedAt } from "#/organization/whatsapp-messages.ts";

// Settling a judged turn of the patient assistant (`assistant.ts`,
// docs/domain/assistant.md § Handoff): its judgement stored, the handoff it
// calls for opened, and what the patient is told, in one transaction.

/** A turn the model judged, with the conversation as it read it. */
export interface JudgedTurn extends TurnToSort {
  conversationId: string;
  read: TurnToSort["read"] & { phone: string; unjudged: { id: string }[] };
  judgement: Judgement;
}

/**
 * Stores the turn's judgement on the messages it judged: for the
 * practitioner when the model judged them so or they open a handoff to the
 * practitioner. A message that arrived meanwhile is left for the next turn.
 */
function storeJudgement(tx: Writer, turn: JudgedTurn, forPractitioner: boolean) {
  const judgement = forPractitioner ? "forPractitioner" : "notForPractitioner";
  tx.update(whatsappMessage)
    .set({ judgement, emergency: turn.judgement.emergency })
    .where(
      and(
        inArray(
          whatsappMessage.id,
          turn.read.unjudged.map((message) => message.id),
        ),
        isNull(whatsappMessage.judgement),
      ),
    )
    .run();
}

/**
 * Adds the kinds of media a later burst sent to the conversation's open
 * `media` handoff to reception, so its reason names everything the patient sent.
 */
function addMediaToOpen(tx: Writer, conversationId: string, media: MediaType[]) {
  if (media.length === 0) {
    return;
  }
  const found = tx
    .select({ id: handoff.id, detail: handoff.detail })
    .from(handoff)
    .where(
      and(
        eq(handoff.conversationId, conversationId),
        eq(handoff.state, "open"),
        eq(handoff.reason, "media"),
        // One passed to the practitioner is theirs now: a later photo is reception's.
        eq(handoff.forPractitioner, false),
      ),
    )
    .get();
  if (!found) {
    return;
  }
  const detail = found.detail ?? { refused: null, applied: [] };
  const merged = [...new Set([...(detail.media ?? []), ...media])];
  tx.update(handoff)
    .set({ detail: { ...detail, media: merged } })
    .where(eq(handoff.id, found.id))
    .run();
}

/**
 * Settles the judged turn in one transaction: stores the judgement, counts a
 * misunderstanding, opens the handoff it calls for, notifies an opt-out, and
 * says what the patient is told. While a member holds the conversation the
 * assistant is silent in it. A handoff it opens to the practitioner says so,
 * one to reception says nothing; one of a kind already open opens nothing,
 * and the model's reply, which leaves that topic to the person, goes as any.
 */
export function settleTurn(
  database: Database,
  judged: Omit<JudgedTurn, "reachedNow">,
): SettledTurn {
  const reachedNow = patientsReachedAt(database, judged.read.phone).map((one) => one.id);
  const turn = { ...judged, reachedNow };
  const wanted = handoffWanted(turn);
  return database.transaction((tx) => {
    storeJudgement(tx, turn, turn.judgement.needsPractitioner || wanted?.forPractitioner === true);
    const open = openHandoffsOf(tx, turn.conversationId);
    const misunderstood = !wanted && !turn.judgement.understood;
    tx.update(conversation)
      .set({ misunderstandings: misunderstood ? turn.read.misunderstandings + 1 : 0 })
      .where(eq(conversation.id, turn.conversationId))
      .run();
    const opened =
      wanted && addsToOpen(open, wanted) ? openHandoff(tx, turn.conversationId, wanted) : null;
    if (wanted && !opened) {
      addMediaToOpen(tx, turn.conversationId, wanted.detail?.media ?? []);
    }
    const optOutAsked = turn.judgement.optOut && holdForOptOut(tx, turn.reachedNow).length > 0;
    return {
      settled: outcomeOf(tx, turn, { opened, wanted, optOutAsked }),
      practitioner: opened?.practitioner ?? null,
      changed: turn.applied.length > 0,
    };
  });
}

/**
 * What the settled turn tells the patient. An emergency is answered whatever
 * is open, and while a member holds the conversation too, who is told at
 * once: nobody may be reading yet. Otherwise a member's hold keeps the
 * assistant silent. A handoff to reception says nothing of what it hands
 * off: only of a change the same turn made, in the model's words.
 */
function outcomeOf(
  tx: Writer,
  turn: JudgedTurn,
  settling: { opened: unknown; wanted: HandoffWanted | null; optOutAsked: boolean },
): SettledTurn["settled"] {
  const held = isHeld(tx, turn.conversationId);
  if (turn.judgement.emergency) {
    if (held) {
      notify(tx, [heldBy(tx, turn.conversationId)!], {
        kind: "emergency",
        conversationId: turn.conversationId,
      });
    }
    return "emergency";
  }
  if (held) {
    return "silent";
  }
  if (settling.opened) {
    if (settling.wanted?.forPractitioner) {
      return "toPractitioner";
    }
    return turn.applied.length > 0 ? "answered" : "handedOff";
  }
  if (turn.unintelligible) {
    return "unintelligible";
  }
  // The fixed reply says the team is told: only with a patient to turn off.
  return settling.optOutAsked ? "optOutAsked" : "answered";
}

/** The member who holds `conversationId`, or `null` while the assistant does. */
function heldBy(tx: Writer, conversationId: string) {
  const row = tx
    .select({ heldBy: conversation.heldBy })
    .from(conversation)
    .where(eq(conversation.id, conversationId))
    .get();
  return row?.heldBy ?? null;
}
