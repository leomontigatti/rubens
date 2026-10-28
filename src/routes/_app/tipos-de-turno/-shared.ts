// The refusal copy the appointment type screens share.

/** The copy for every refusal the appointment type server functions return. */
export const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador o el propio profesional pueden cambiar sus tipos de turno.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "No encontramos ese profesional o ese tipo de turno.",
  practitionerInactive: "El profesional está desactivado: no se le pueden cargar tipos de turno.",
};

export type RefusalReason = keyof typeof refusalMessages;
