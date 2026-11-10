import { generateTranscription } from "@tanstack/ai";
import { createCloudflareTranscription } from "@tanstack/ai-cloudflare";
import type { CloudflareBindingConfig } from "@tanstack/ai-cloudflare";

import { transcriptionModelId } from "#/lib/assistant.ts";

// The transcription port (docs/domain/assistant.md § For patients): a
// patient's voice note in, its words and its length out. Whisper on Workers
// AI, decided on #151 from the evaluation report, through the Worker's AI
// binding, so it needs no key; Workers AI keeps nothing after the response.
// The object's tests put a scripted transcriber behind the same port
// (`assistant-model.test-support.ts`). Nothing here keeps or logs the audio
// or its words.

/** What a voice note says, and how long its audio lasts, which is what Workers AI bills. */
export interface Transcript {
  text: string;
  seconds: number;
}

export interface Transcriber {
  /** Transcribes `audio`, of the media type `mimeType`, in Spanish. */
  transcribe(audio: ArrayBuffer, mimeType: string): Promise<Transcript>;
}

export function transcriberFor(env: { AI?: Ai }): Transcriber {
  return {
    async transcribe(audio, mimeType) {
      if (!env.AI) {
        throw new Error("The Worker has no AI binding: check wrangler.jsonc");
      }
      const result = await generateTranscription({
        adapter: createCloudflareTranscription(transcriptionModelId, {
          // TanStack AI types the binding with an older release of the Workers types.
          binding: env.AI as unknown as CloudflareBindingConfig["binding"],
        }),
        threadId: crypto.randomUUID(),
        audio: new Blob([audio], { type: mimeType }),
        language: "es",
      });
      // Whisper reports the audio's length; its last segment's end stands in when it does not.
      const seconds = result.duration ?? result.segments?.at(-1)?.end ?? 0;
      return { text: result.text, seconds };
    },
  };
}
