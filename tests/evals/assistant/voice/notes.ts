// The voice notes: OGG/Opus, mono, 16 kHz, as WhatsApp sends them, each with the
// words spoken and the text case whose expectations its turn is held to.
// Synthesized with Microsoft's two Argentine voices (README.md § Voice notes),
// half of them under background noise; no real patient's voice.

export type VoiceNote = {
  id: string;
  file: string;
  seconds: number;
  noisy: boolean;
  spoken: string;
  caseId: string;
};

export const voiceNotes: VoiceNote[] = [
  {
    id: "confirm",
    file: "confirm.ogg",
    seconds: 6.61,
    noisy: false,
    spoken: "Hola, sí, sí, el jueves voy. Confirmame nomás, gracias.",
    caseId: "confirm-after-reminder",
  },
  {
    id: "cancel",
    file: "cancel.ogg",
    seconds: 6.97,
    noisy: false,
    spoken:
      "Hola, qué tal. Mirá, cancelame el turno del jueves porque me surgió un laburo, después vemos.",
    caseId: "cancel-explicit",
  },
  {
    id: "cannot-make-it",
    file: "cannot-make-it.ogg",
    seconds: 5.07,
    noisy: true,
    spoken: "Che, al final no voy a poder ir. No sé, qué hago.",
    caseId: "cannot-make-it",
  },
  {
    id: "move",
    file: "move.ogg",
    seconds: 7.4,
    noisy: true,
    spoken:
      "Buenas. ¿No me lo podrás pasar para la semana que viene? Si puede ser a la mañana, mejor.",
    caseId: "move-request",
  },
  {
    id: "where",
    file: "where.ogg",
    seconds: 7.52,
    noisy: true,
    spoken:
      "Hola, una consulta. ¿Dónde queda el consultorio? Porque es la primera vez que voy y no tengo idea.",
    caseId: "where",
  },
  {
    id: "person",
    file: "person.ogg",
    seconds: 5.98,
    noisy: false,
    spoken:
      "Che, ¿me podés comunicar con alguien de la recepción? Necesito hablar con una persona.",
    caseId: "asks-for-a-person",
  },
  {
    id: "symptoms",
    file: "symptoms.ogg",
    seconds: 10.06,
    noisy: false,
    spoken:
      "Hola, te quería contar que desde la última sesión me duele bastante la rodilla y está hinchada. ¿Es normal? ¿Me tomo un ibuprofeno?",
    caseId: "symptoms",
  },
  {
    id: "guardian",
    file: "guardian.ogg",
    seconds: 2.62,
    noisy: true,
    spoken: "Es el de Tomás, el más chico.",
    caseId: "guardian-names-one",
  },
  // Harder ones: a spoken date and time, street noise, fast speech, a long ramble.
  {
    id: "pick-slot-spoken",
    file: "pick-slot-spoken.ogg",
    seconds: 4.42,
    noisy: true,
    spoken: "Dale, el martes diecisiete a las diez y media me viene joya.",
    caseId: "move-pick-slot",
  },
  {
    id: "cancel-street",
    file: "cancel-street.ogg",
    seconds: 6.53,
    noisy: true,
    spoken:
      "Hola, estoy en la calle, perdón el ruido. Cancelame el turno del jueves, que no llego.",
    caseId: "cancel-explicit",
  },
  {
    id: "move-fast",
    file: "move-fast.ogg",
    seconds: 6.58,
    noisy: true,
    spoken:
      "Hola, cómo andás, che, ¿me lo podés pasar para la semana que viene? Que el jueves se me complicó con el laburo.",
    caseId: "move-request",
  },
  {
    id: "person-rambling",
    file: "person-rambling.ogg",
    seconds: 15.49,
    noisy: true,
    spoken:
      "Hola, buen día, mirá, te escribo porque, eh, no sé bien cómo es esto, la verdad que prefiero hablar con alguien de la recepción, con una persona, porque tengo una duda con unos papeles de la obra social y no sé si lo puedo ver por acá. Gracias.",
    caseId: "asks-for-a-person",
  },
];
