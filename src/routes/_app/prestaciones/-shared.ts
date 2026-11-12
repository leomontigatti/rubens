// The refusal copy the medical service screens share.

import { maxReminders } from "#/lib/medical-services.ts";

/** A medical service picks too many reminders: the form's own check and the object's refusal. */
export const tooManyRemindersText = `Elegí hasta ${maxReminders} recordatorios: plantillas que van antes del turno.`;

/** The copy for every refusal the medical service server functions return. */
export const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador o el propio profesional pueden cambiar sus prestaciones.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "No encontramos ese profesional o esa prestación.",
  practitionerInactive: "El profesional está desactivado: no se le pueden cargar prestaciones.",
  unknownTemplate: "Una de las plantillas ya no existe: volvé a cargar la página.",
  tooManyReminders: tooManyRemindersText,
};

export type RefusalReason = keyof typeof refusalMessages;
