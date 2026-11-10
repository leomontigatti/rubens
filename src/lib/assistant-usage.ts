import { assistantModelId } from "#/lib/assistant.ts";

// The assistant's usage as the WhatsApp settings show it (docs/domain/assistant.md
// § Costs): the month's name, and each model's tokens, the sandbox's apart.

/** One line of the month's usage: a model's tokens, in the sandbox or not. */
interface UsedTokens {
  model: string;
  sandbox: boolean;
  inputTokens: number;
  outputTokens: number;
}

const modelNames: Record<string, string> = { [assistantModelId]: "Claude Haiku 5.5" };

// Read from noon UTC of the first, so no zone moves it to another month.
const monthFormat = new Intl.DateTimeFormat("es-AR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const tokenFormat = new Intl.NumberFormat("es-AR");

/** `2098-12` as `diciembre de 2098`. */
export function usageMonthName(month: string) {
  return monthFormat.format(new Date(`${month}-01T12:00:00Z`));
}

/** A model's tokens as the settings list them: who used them, and how many each way. */
export function usageLine(used: UsedTokens) {
  const model = modelNames[used.model] ?? used.model;
  return {
    label: `${model} · ${used.sandbox ? "Prueba" : "Pacientes"}`,
    value: `${tokenFormat.format(used.inputTokens)} de entrada · ${tokenFormat.format(used.outputTokens)} de salida`,
  };
}
