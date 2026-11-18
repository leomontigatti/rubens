import { describe, expect, it } from "vite-plus/test";

import {
  newMessagesMark,
  staffReplyNote,
  withdrawnReplyNote,
  longPauseNote,
} from "#/lib/assistant.ts";
import { announcesHandoff, leaksInternals } from "#/lib/reply-leaks.ts";

describe("leaksInternals", () => {
  it.each([
    "Listo, llamé a find_free_times y tengo el martes.",
    "Ya hice el HAND_OFF.",
    "accept_proposal falló, el cambio no se hizo.",
  ])("finds a tool's name: %s", (reply) => {
    expect(leaksInternals(reply)).toBe(true);
  });

  it.each([newMessagesMark, withdrawnReplyNote, staffReplyNote, longPauseNote])(
    "finds the prompt's mark or note %s",
    (mark) => {
      expect(leaksInternals(`Hola Martina.\n${mark}\nTu turno es el lunes.`)).toBe(true);
    },
  );

  it("finds a reaction line as the prompt writes it", () => {
    expect(leaksInternals("[reaccionó 👍 al mensaje: «Te esperamos»] Perfecto.")).toBe(true);
  });

  it("finds a mark in another case", () => {
    expect(leaksInternals("[New Messages] hola")).toBe(true);
  });

  it.each([
    "Listo, te pasé el turno del jueves al viernes 10:00.",
    "Tu turno es el lunes a las 10:00 en Sede Norte.",
    "Te paso la lista de horarios libres: martes 10:00 o miércoles 11:30.",
  ])("finds nothing in a reply about appointments: %s", (reply) => {
    expect(leaksInternals(reply)).toBe(false);
  });
});

describe("announcesHandoff", () => {
  it.each([
    "Ya se lo pasé, te va a responder por acá.",
    "Listo, confirmado el lunes. Ya se lo pasé al equipo.",
    "Lo derivé a recepción.",
    "Derivé tu consulta.",
    "Te va a contactar alguien del equipo.",
    "Le va a contactar alguien del equipo.",
    "Te van a escribir del consultorio.",
    "Ya está, te van a llamar desde recepción.",
    "Lo va a llamar alguien del equipo.",
    "Ya se lo pasé y pronto vas a tener una respuesta.",
    "Una persona del equipo le va a escribir.",
    "Ya te paso con recepción.",
    "Pasé tu consulta a una persona del equipo.",
    "Le pasé su mensaje a la secretaria.",
    "Se van a comunicar con vos.",
    "Se va a comunicar con usted alguien de recepción.",
    "Le avisé al equipo.",
    "Listo, confirmado el lunes. Te van a llamar.",
    "Ya se lo pasé así te responden.",
    "Listo, quedó para el martes. Ya se lo pase al equipo.",
  ])("finds an announced handoff: %s", (reply) => {
    expect(announcesHandoff(reply)).toBe(true);
  });

  it.each([
    "Listo, te pasé el turno del jueves al viernes 10:00.",
    "Perfecto, te lo paso al martes 24 a las 10:30 en Sede Norte. Te parece bien?",
    "Perfecto, se lo paso al martes 24 a las 10:30. Le parece bien?",
    "Listo, ya se lo pasé al viernes 10:00.",
    "Listo, te lo paso para el martes 10:00.",
    "La Dra. Paz te va a atender en Sede Norte.",
    "Listo, confirmado el lunes.",
    "Confirmado el lunes. Cuando llegues, te van a llamar por tu nombre.",
    "Te paso con gusto los horarios libres: martes 10:00.",
    "Te los paso así elegís: martes 10:00 o miércoles 11:30.",
    "Ya estás anotada. Te va a llamar la doctora.",
    "Tengo martes 10:00 o miércoles 11:30, te los paso para que elijas.",
    "Listo, confirmado el lunes, no hace falta que te lo pase.",
  ])("finds nothing in a change or a proposal: %s", (reply) => {
    expect(announcesHandoff(reply)).toBe(false);
  });

  it.each([
    "No te va a contactar nadie más por esto.",
    "Todavía no se lo pasé a nadie.",
    "Nunca lo derivé.",
    "Ni lo derivé ni le avisé al equipo.",
  ])("skips a negated sentence: %s", (reply) => {
    expect(announcesHandoff(reply)).toBe(false);
  });

  it("finds an announcement after a negated sentence", () => {
    expect(announcesHandoff("No pude cambiar el turno. Ya se lo pasé al equipo.")).toBe(true);
  });

  it("finds an announcement in a clause of its own beside a negated one", () => {
    expect(announcesHandoff("No pude cambiarlo, así que lo derivé a recepción.")).toBe(true);
  });

  it.each([
    "Ya se lo pasé al equipo para que no tengas que repetirlo.",
    "Ya lo derivé y no tenés que hacer nada.",
    "Le avisé al equipo para que no esperes.",
    "No te preocupes que ya se lo pasé al equipo.",
    "Ya se lo pasé para que no esperes.",
    "No hace falta que repitas, que lo derivé.",
  ])("finds an announcement a negation only follows: %s", (reply) => {
    expect(announcesHandoff(reply)).toBe(true);
  });
});
