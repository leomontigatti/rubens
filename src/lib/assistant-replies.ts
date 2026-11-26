import type { FormOfAddress } from "#/lib/communication-rules.ts";

// The patient assistant's fixed replies: what underthing sends the patient
// itself, in the organization's form of address, so a reply that must say
// something exact never depends on the model's wording
// (docs/domain/assistant.md § Handoff).

/**
 * What the patient is told when they ask again about what a person already
 * has: underthing sends it, after the model's reply. Fixed, so the model's
 * wording cannot leave it out.
 */
export function alreadyHandedOffReply(formOfAddress: FormOfAddress): string {
  return formOfAddress === "usted"
    ? "Ya se lo pasé, le va a responder por acá."
    : "Ya se lo pasé, te va a responder por acá.";
}

/**
 * What the patient is told when they ask the practice to stop writing: that
 * the team is told, since a person turns their WhatsApp consent off. Fixed,
 * so it promises nothing the model wrote.
 */
export function optOutReply(formOfAddress: FormOfAddress): string {
  return formOfAddress === "usted"
    ? "Entendido. Le avisamos al equipo para que no le enviemos más mensajes por WhatsApp."
    : "Entendido. Le avisamos al equipo para que no te enviemos más mensajes por WhatsApp.";
}

export function tapConfirmedReply(formOfAddress: FormOfAddress): string {
  return formOfAddress === "usted" ? "Genial, muchas gracias!" : "Genial, te esperamos!";
}

/**
 * What the patient is told of a voice note that could not be understood: a
 * request to write it. Fixed, since the assistant's model never read the note.
 */
export function unintelligibleVoiceReply(formOfAddress: FormOfAddress): string {
  return formOfAddress === "usted"
    ? "Perdón, no pudimos entender su nota de voz. Escríbanos lo que necesita, por favor."
    : "Perdón, no pudimos entender tu nota de voz. Escribinos lo que necesitás, por favor.";
}

/**
 * What the patient is told when the assistant hands the conversation to the
 * practitioner: to `practitioner`, the appointment's, by the name patients
 * read, or to the practitioner when no appointment names one. Fixed, so a
 * handoff's reply says nothing the model wrote. Any other handoff tells the
 * patient nothing.
 */
export function practitionerHandoffReply(
  formOfAddress: FormOfAddress,
  practitioner: string | null,
): string {
  const consultation = formOfAddress === "usted" ? "su consulta" : "tu consulta";
  return `Le paso ${consultation} ${practitioner ? `a ${practitioner}` : "al profesional"}.`;
}

const emergencyNumber = "107";

/**
 * What the patient is told on a message judged an emergency: the emergency
 * number, the organization's phone when it has one (`formattedPhone`, as
 * patients dial it) and that the team is told. Fixed, so an emergency is never
 * answered with words the model wrote.
 */
export function emergencyReply(formOfAddress: FormOfAddress, formattedPhone: string): string {
  const usted = formOfAddress === "usted";
  const call = `Si es una urgencia, ${usted ? "llame" : "llamá"} ahora al ${emergencyNumber} (emergencias).`;
  const phone = formattedPhone
    ? ` También ${usted ? "puede" : "podés"} llamarnos al ${formattedPhone}.`
    : "";
  return `${call}${phone} Ya le pasamos ${usted ? "su" : "tu"} mensaje a una persona del equipo.`;
}
