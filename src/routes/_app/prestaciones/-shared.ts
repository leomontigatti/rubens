// The refusal copy the medical service screens share.

/** The object checks the length against the approved template; the form also shows it for text over the schema's cap. */
export const careInstructionsTooLongMessage =
  "Las indicaciones no entran en la plantilla de WhatsApp: acortalas.";

/** The copy for every refusal the medical service server functions return. */
export const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador o el propio profesional pueden cambiar sus prestaciones.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "No encontramos ese profesional o esa prestación.",
  practitionerInactive: "El profesional está desactivado: no se le pueden cargar prestaciones.",
  careInstructionsTooLong: careInstructionsTooLongMessage,
};

export type RefusalReason = keyof typeof refusalMessages;
