// The transcription options under evaluation, each through TanStack AI. Rates
// are USD per minute of audio; Gemini's is per audio token, so its cost comes
// from the usage it reports.

import {
  chat,
  generateTranscription,
  type AnyTranscriptionAdapter,
  type ChatMiddleware,
} from "@tanstack/ai";
import { createCloudflareTranscription } from "@tanstack/ai-cloudflare";
import { geminiText } from "@tanstack/ai-gemini";
import { openaiTranscription } from "@tanstack/ai-openai";

export type Transcript = { text: string; cost?: number };

export type Transcriber = {
  label: string;
  perMinute?: number;
  transcribe(audio: File, seconds: number): Promise<Transcript>;
};

function cloudflare() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiKey = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiKey) throw new Error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN");
  return { accountId, apiKey };
}

function byMinute(
  label: string,
  perMinute: number | undefined,
  adapter: () => AnyTranscriptionAdapter,
): Transcriber {
  return {
    label,
    perMinute,
    async transcribe(audio, seconds) {
      const result = await generateTranscription({
        adapter: adapter(),
        threadId: `transcribe-${audio.name}`,
        audio,
        language: "es",
      });
      return {
        text: result.text,
        cost: perMinute === undefined ? undefined : (perMinute * seconds) / 60,
      };
    },
  };
}

// Gemini has no transcription adapter: the model hears the note in a chat turn.
function geminiHears(
  label: string,
  model: string,
  rates: { input: number; output: number },
): Transcriber {
  return {
    label,
    async transcribe(audio) {
      if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY)
        throw new Error("Set GOOGLE_API_KEY or GEMINI_API_KEY");
      const usage = { input: 0, output: 0 };
      const meter: ChatMiddleware = {
        name: "meter",
        onUsage: (_context, used) => {
          usage.input += used.promptTokens ?? 0;
          usage.output += used.completionTokens ?? 0;
        },
      };
      const value = Buffer.from(await audio.arrayBuffer()).toString("base64");
      const { text } = await chat({
        adapter: geminiText(model as Parameters<typeof geminiText>[0]),
        threadId: `transcribe-${audio.name}`,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                content:
                  "Transcribe this WhatsApp voice note word for word, in the Spanish it is spoken in. Output only the transcript.",
              },
              { type: "audio", source: { type: "data", value, mimeType: "audio/ogg" } },
            ],
          },
        ],
        middleware: [meter],
        modelOptions: { temperature: 0 },
        stream: false,
      });
      return { text, cost: (usage.input * rates.input + usage.output * rates.output) / 1_000_000 };
    },
  };
}

export const transcribers: Transcriber[] = [
  byMinute("gpt-4o-mini-transcribe", 0.003, () => openaiTranscription("gpt-4o-mini-transcribe")),
  byMinute("gpt-4o-transcribe", 0.006, () => openaiTranscription("gpt-4o-transcribe")),
  byMinute("whisper-large-v3-turbo", 0.0005, () =>
    createCloudflareTranscription("@cf/openai/whisper-large-v3-turbo", cloudflare()),
  ),
  byMinute("nova-3 (Workers AI)", 0.0052, () =>
    createCloudflareTranscription("@cf/deepgram/nova-3", cloudflare()),
  ),
  geminiHears("gemini-3.1-flash-lite (audio)", "gemini-3.1-flash-lite", {
    input: 0.5,
    output: 1.5,
  }),
];

export function findTranscriber(label: string): Transcriber {
  const found = transcribers.find((each) => each.label === label);
  if (!found) throw new Error(`No transcriber ${label}`);
  return found;
}
