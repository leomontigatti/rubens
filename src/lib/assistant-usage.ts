import { assistantModelId, transcriptionModelId } from "#/lib/assistant.ts";
import { formatMonth } from "#/lib/dates.ts";

// The assistant's usage as the WhatsApp settings show it (docs/domain/assistant.md
// § Costs): the month's name, each model's tokens and the audio its voice
// notes' transcription heard, the sandbox's apart.

/** One line of the month's usage: a model's tokens, in the sandbox or not. */
interface UsedTokens {
  model: string;
  sandbox: boolean;
  inputTokens: number;
  outputTokens: number;
}

/** One line of the month's transcription: the audio a model heard, in the sandbox or not. */
interface HeardAudio {
  model: string;
  sandbox: boolean;
  seconds: number;
}

const modelNames: Record<string, string> = {
  [assistantModelId]: "Claude Haiku 5.5",
  [transcriptionModelId]: "Whisper",
};

const tokenFormat = new Intl.NumberFormat("es-AR");

const minuteFormat = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

/** `2098-12` as `diciembre de 2098`. */
export function usageMonthName(month: string) {
  return formatMonth(month);
}

/** Which model was used, and by whom. */
function usageLabel(used: { model: string; sandbox: boolean }) {
  const model = modelNames[used.model] ?? used.model;
  return `${model} · ${used.sandbox ? "Prueba" : "Pacientes"}`;
}

/** A model's tokens as the settings list them: who used them, and how many each way. */
export function usageLine(used: UsedTokens) {
  return {
    label: usageLabel(used),
    value: `${tokenFormat.format(used.inputTokens)} de entrada · ${tokenFormat.format(used.outputTokens)} de salida`,
  };
}

/** The audio a transcription model heard, as the settings list it: in minutes, or seconds under one. */
export function transcriptionLine(heard: HeardAudio) {
  const value =
    heard.seconds < 60
      ? `${Math.round(heard.seconds)} s de audio`
      : `${minuteFormat.format(heard.seconds / 60)} min de audio`;
  return { label: usageLabel(heard), value };
}
