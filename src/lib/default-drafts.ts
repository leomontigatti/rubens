import type { FormOfAddress } from "#/lib/communication-rules.ts";

// The drafts every organization starts with, in each `Trato`, as
// docs/operations/whatsapp-templates.md words them.

const defaultDrafts: readonly Record<FormOfAddress, string>[] = [
  {
    vos: "Hola {{paciente}}! Te escribimos de {{organizacion}} para avisarte que tu turno con {{profesional}} del {{fecha}} a las {{hora}} quedó reservado. Escribinos por cualquier duda. Saludos!",
    usted:
      "Hola {{paciente}}! Le escribimos de {{organizacion}} para avisarle que su turno con {{profesional}} del {{fecha}} a las {{hora}} quedó reservado. Escríbanos por cualquier duda. Saludos!",
  },
  {
    vos: "Hola {{paciente}}! Te escribimos de {{organizacion}} para recordarte tu turno con {{profesional}} del {{fecha}} a las {{hora}}. Por favor, confirmanos si venís o si necesitás cambiarlo.",
    usted:
      "Hola {{paciente}}! Le escribimos de {{organizacion}} para recordarle su turno con {{profesional}} del {{fecha}} a las {{hora}}. Por favor, confírmenos si viene o si necesita cambiarlo.",
  },
  {
    vos: "Hola {{paciente}}! Te escribimos de {{organizacion}} para recordarte que tu turno con {{profesional}} es el {{fecha}} a las {{hora}}. Te esperamos!",
    usted:
      "Hola {{paciente}}! Le escribimos de {{organizacion}} para recordarle que su turno con {{profesional}} es el {{fecha}} a las {{hora}}. Hasta pronto!",
  },
  {
    vos: "Hola {{paciente}}! Te escribimos de {{organizacion}} para saber cómo te sentís después de tu {{prestacion}}.",
    usted:
      "Hola {{paciente}}! Le escribimos de {{organizacion}} para saber cómo se siente después de su {{prestacion}}.",
  },
  {
    vos: "Hola {{paciente}}! Te escribimos de {{organizacion}} para avisarte que tuvimos que mover tu turno con {{profesional}} al {{fecha}} a las {{hora}}. Por favor, confirmanos si venís o si necesitás cambiarlo.",
    usted:
      "Hola {{paciente}}! Le escribimos de {{organizacion}} para avisarle que tuvimos que mover su turno con {{profesional}} al {{fecha}} a las {{hora}}. Por favor, confírmenos si viene o si necesita cambiarlo.",
  },
  {
    vos: "Hola {{paciente}}! Te escribimos de {{organizacion}} para avisarte que lamentablemente {{profesional}} no va a poder atenderte el {{fecha}} a las {{hora}}. Por favor, escribinos si querés sacar un turno nuevo.",
    usted:
      "Hola {{paciente}}! Le escribimos de {{organizacion}} para avisarle que lamentablemente {{profesional}} no va a poder atender su turno del {{fecha}} a las {{hora}}. Por favor, escríbanos si quiere sacar un turno nuevo.",
  },
  {
    vos: "Hola {{paciente}}! Te escribimos de {{organizacion}} para avisarte que lamentablemente no pudimos confirmar el turno que pediste con {{profesional}} para el {{fecha}}. Por favor, escribinos si querés buscar otro horario.",
    usted:
      "Hola {{paciente}}! Le escribimos de {{organizacion}} para avisarle que lamentablemente no pudimos confirmar el turno que pidió con {{profesional}} para el {{fecha}}. Por favor, escríbanos si quiere buscar otro horario.",
  },
  {
    vos: "Hola {{paciente}}! Te escribimos de {{organizacion}} porque tenemos una respuesta para vos. Respondé este mensaje para verla.",
    usted:
      "Hola {{paciente}}! Le escribimos de {{organizacion}} porque tenemos una respuesta para usted. Responda este mensaje para verla.",
  },
];

function defaultDraftOf(draft: string) {
  return defaultDrafts.find((one) => one.vos === draft || one.usted === draft);
}

export function isDefaultDraft(draft: string) {
  return defaultDraftOf(draft) !== undefined;
}

export function defaultDraftIn(formOfAddress: FormOfAddress, draft: string): string | null {
  return defaultDraftOf(draft)?.[formOfAddress] ?? null;
}
