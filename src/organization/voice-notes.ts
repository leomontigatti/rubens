import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import * as z from "zod";

import { transcriptionModelId } from "#/lib/assistant.ts";

import { recordTranscription } from "#/organization/assistant-usage.ts";
import type { CommunicationRules } from "#/organization/communication-rules.ts";
import type { Database } from "#/organization/database.ts";
import type { WhatsappCloud } from "#/organization/graph-api.ts";
import type { Transcriber } from "#/organization/transcription.ts";
import { whatsappMessage } from "#/organization/whatsapp-schema.ts";

// Patients' voice notes (docs/domain/assistant.md § For patients): before a
// turn reads a conversation, each voice note it has not judged is downloaded
// from Meta and transcribed, and its transcript stored as the message's words,
// so the turn reads it as the same words written and the inbox shows it.
// The audio is never stored: Meta keeps the media, and the message's payload
// its id. A transcript with no words is a note nobody could understand
// (`assistant.ts` asks the patient to write it). Nothing here logs a
// patient's words.

/** The part of Meta's audio message the object reads: its media id. */
const voiceNoteSchema = z.object({ audio: z.object({ id: z.string().min(1) }) });

/** Why a voice note's audio could not be had, in words that carry no patient data. */
class AudioUnavailable extends Error {
  override name = "AudioUnavailable";
}

/** The words of the voice note whose Meta message is `payload`. */
async function transcriptOf(cloud: WhatsappCloud, transcriber: Transcriber, payload: string) {
  const parsed = voiceNoteSchema.safeParse(JSON.parse(payload));
  if (!parsed.success) {
    throw new AudioUnavailable("the message has no media id");
  }
  const missing = cloud.missingSetting();
  if (missing) {
    throw new AudioUnavailable(missing);
  }
  const media = await cloud.downloadMedia(parsed.data.audio.id);
  if (!media.ok) {
    throw new AudioUnavailable(`Meta refused the media (code ${media.metaError.code})`);
  }
  return transcriber.transcribe(media.bytes, media.mimeType);
}

/** The voice notes among the patient's messages `messageIds` with no transcript yet, oldest first. */
function untranscribed(database: Database, messageIds: string[]) {
  return database
    .select({ id: whatsappMessage.id, payload: whatsappMessage.payload })
    .from(whatsappMessage)
    .where(
      and(
        inArray(whatsappMessage.id, messageIds),
        eq(whatsappMessage.direction, "incoming"),
        eq(whatsappMessage.type, "audio"),
        isNull(whatsappMessage.text),
      ),
    )
    .orderBy(asc(whatsappMessage.sentAt))
    .all();
}

/**
 * Transcribes the voice notes among the patient's messages `messageIds`,
 * recording each transcription's audio length (§ Costs). Says whether each
 * one has its transcript now: one Meta did not serve, or transcription could
 * not hear, waits for the turn's retry (`turn-retries.ts`), like a message
 * the model could not read.
 */
export async function transcribeVoiceNotes(
  database: Database,
  cloud: WhatsappCloud,
  transcriber: Transcriber,
  messageIds: string[],
) {
  let transcribed = true;
  for (const note of untranscribed(database, messageIds)) {
    const transcript = await transcriptOf(cloud, transcriber, note.payload).catch(
      (error: unknown) => {
        // Another error can quote Meta's or Workers AI's answer, so only its class is logged.
        const why =
          error instanceof AudioUnavailable
            ? error.message
            : error instanceof Error
              ? error.name
              : typeof error;
        console.error(`[voice-notes] no transcript for message ${note.id}: ${why}`);
        return null;
      },
    );
    if (!transcript) {
      transcribed = false;
      continue;
    }
    database.transaction((tx) => {
      tx.update(whatsappMessage)
        .set({ text: transcript.text.trim() })
        .where(eq(whatsappMessage.id, note.id))
        .run();
      recordTranscription(tx, {
        model: transcriptionModelId,
        seconds: transcript.seconds,
        sandbox: false,
      });
    });
  }
  return transcribed;
}

/** Whether every one of `messages` is a voice note nobody could understand: a transcript with no words. */
export function allUnintelligible(messages: { type: string; text: string | null }[]) {
  return messages.every((message) => message.type === "audio" && message.text === "");
}

/**
 * The turn of voice notes nobody could understand, which the model does not
 * read: misunderstood, so the patient is asked to write, and a second
 * misunderstanding in a row is handed off (`turn-handoffs.ts`).
 */
export function unintelligibleTurn(rules: CommunicationRules) {
  return {
    reply: "",
    judgement: { needsPractitioner: false, emergency: false, understood: false, optOut: false },
    handOff: null,
    ruleRefused: null,
    refusal: null,
    applied: [],
    proposed: false,
    rules,
    unintelligible: true,
  };
}
