// The refusal copy the medical service screens share.

/** The copy for every refusal the medical service server functions return. */
export const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador o el propio profesional pueden cambiar sus prestaciones.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "No encontramos ese profesional o esa prestación.",
  practitionerInactive: "El profesional está desactivado: no se le pueden cargar prestaciones.",
};

export type RefusalReason = keyof typeof refusalMessages;
