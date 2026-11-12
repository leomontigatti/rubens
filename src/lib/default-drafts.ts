import type { FormOfAddress } from "#/lib/communication-rules.ts";

// The drafts every organization starts with, in each `Trato`, as
// docs/operations/whatsapp-templates.md words them: the four of its own and the
// five event templates'. The migrations insert them worded in `vos`; a draft never
// sent that still reads as one of these follows the `Trato` an admin saves.

const defaultDrafts: readonly Record<FormOfAddress, string>[] = [
  {
    vos: "Hola {{paciente}}, te escribimos de {{organizacion}}: tu turno con {{profesional}} quedó reservado para el {{fecha}} a las {{hora}} en {{sede}} ({{direccion}}). Si necesitás cambiarlo, respondé este mensaje.",
    usted:
      "Hola {{paciente}}, le escribimos de {{organizacion}}: su turno con {{profesional}} quedó reservado para el {{fecha}} a las {{hora}} en {{sede}} ({{direccion}}). Si necesita cambiarlo, responda este mensaje.",
  },
  {
    vos: "Hola {{paciente}}, te escribimos de {{organizacion}} para recordarte tu turno con {{profesional}} del {{fecha}} a las {{hora}} en {{sede}}. Respondé este mensaje para confirmar que venís, o si necesitás cancelarlo o cambiarlo.",
    usted:
      "Hola {{paciente}}, le escribimos de {{organizacion}} para recordarle su turno con {{profesional}} del {{fecha}} a las {{hora}} en {{sede}}. Responda este mensaje para confirmar que viene, o si necesita cancelarlo o cambiarlo.",
  },
  {
    vos: "Hola {{paciente}}, te escribimos de {{organizacion}}: tu turno con {{profesional}} es el {{fecha}} a las {{hora}} en {{sede}} ({{direccion}}). Te esperamos.",
    usted:
      "Hola {{paciente}}, le escribimos de {{organizacion}}: su turno con {{profesional}} es el {{fecha}} a las {{hora}} en {{sede}} ({{direccion}}). Hasta pronto.",
  },
  {
    vos: "Hola {{paciente}}, te escribimos de {{organizacion}} por tu turno del {{fecha}} con {{profesional}}. Contanos cómo te sentís respondiendo este mensaje.",
    usted:
      "Hola {{paciente}}, le escribimos de {{organizacion}} por su turno del {{fecha}} con {{profesional}}. Cuéntenos cómo se siente respondiendo este mensaje.",
  },
  {
    vos: "Hola {{paciente}}, te escribimos de {{organizacion}}: tuvimos que mover tu turno con {{profesional}}, que ahora es el {{fecha}} a las {{hora}} en {{sede}}. Si no te queda bien, respondé este mensaje y buscamos otro horario.",
    usted:
      "Hola {{paciente}}, le escribimos de {{organizacion}}: tuvimos que mover su turno con {{profesional}}, que ahora es el {{fecha}} a las {{hora}} en {{sede}}. Si no le queda bien, responda este mensaje y buscamos otro horario.",
  },
  {
    vos: "Hola {{paciente}}, te escribimos de {{organizacion}}: tuvimos que cancelar tu turno con {{profesional}} del {{fecha}} a las {{hora}}. Disculpá las molestias. Respondé este mensaje y buscamos otro horario.",
    usted:
      "Hola {{paciente}}, le escribimos de {{organizacion}}: tuvimos que cancelar su turno con {{profesional}} del {{fecha}} a las {{hora}}. Disculpe las molestias. Responda este mensaje y buscamos otro horario.",
  },
  {
    vos: "Hola {{paciente}}, te escribimos de {{organizacion}}: tuvimos que mover tu turno del {{fecha}} con {{profesional}}. Respondé este mensaje y buscamos otro horario.",
    usted:
      "Hola {{paciente}}, le escribimos de {{organizacion}}: tuvimos que mover su turno del {{fecha}} con {{profesional}}. Responda este mensaje y buscamos otro horario.",
  },
  {
    vos: "Hola {{paciente}}, te escribimos de {{organizacion}}: no pudimos confirmar el turno que pediste con {{profesional}} para el {{fecha}}. Respondé este mensaje y buscamos otro horario.",
    usted:
      "Hola {{paciente}}, le escribimos de {{organizacion}}: no pudimos confirmar el turno que pidió con {{profesional}} para el {{fecha}}. Responda este mensaje y buscamos otro horario.",
  },
  {
    vos: "Hola {{paciente}}, te escribimos de {{organizacion}}: tenemos una respuesta para vos. Respondé este mensaje para verla.",
    usted:
      "Hola {{paciente}}, le escribimos de {{organizacion}}: tenemos una respuesta para usted. Responda este mensaje para verla.",
  },
];

function defaultDraftOf(draft: string) {
  return defaultDrafts.find((one) => one.vos === draft || one.usted === draft);
}

/** Whether `draft` is one of the default drafts, in either `Trato`. */
export function isDefaultDraft(draft: string) {
  return defaultDraftOf(draft) !== undefined;
}

/**
 * `draft` worded in `formOfAddress`, when it is one of the default drafts in
 * either `Trato`; `null` for a text the organization wrote.
 */
export function defaultDraftIn(formOfAddress: FormOfAddress, draft: string): string | null {
  return defaultDraftOf(draft)?.[formOfAddress] ?? null;
}
