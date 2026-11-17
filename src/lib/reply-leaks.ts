import {
  assistantToolSchemas,
  longPauseNote,
  newMessagesMark,
  staffReplyNote,
  withdrawnReplyNote,
} from "#/lib/assistant.ts";
import { reactionMark } from "#/lib/reactions.ts";

// Two code checks on the model's reply, beside the fixed ones
// (`reply-checks.ts`, docs/domain/assistant.md § Rules it always keeps): a
// reply that names one of the assistant's tools or holds one of the prompt's
// marks or notes, and, in a turn whose handoff the patient is told nothing
// about, one that says it passed the conversation on. Either is held
// (`turn-replies.ts`). Each is a cheap match, so the prompt stays the first
// guard and these only catch what slips past it.

const toolNames = new RegExp(
  `(?<!\\w)(?:${Object.keys(assistantToolSchemas).join("|")})(?!\\w)`,
  "iu",
);

/** What the prompt's marks and notes start with, as the model reads them: none ever reaches a patient. */
const marks = [
  newMessagesMark,
  withdrawnReplyNote,
  staffReplyNote,
  longPauseNote,
  reactionMark,
].map((mark) => mark.toLowerCase());

/** Whether `reply` names one of the assistant's tools or holds one of the prompt's marks or notes. */
export function leaksInternals(reply: string) {
  const lower = reply.toLowerCase();
  return toolNames.test(reply) || marks.some((mark) => lower.includes(mark));
}

/** `source` as a whole word or phrase: no letter right before or after it. */
const word = (source: string) => `(?<!\\p{L})(?:${source})(?!\\p{L})`;

/** Whom a conversation is passed to, as a reply names them. */
const person = String.raw`una persona|alguien|(?:el |nuestro )?equipo|(?:la )?recepci[oó]n|(?:la )?secretar[ií]a|(?:el |la )?(?:profesional|doctora?|dra?\.?)`;

/** What a reply says when it passed the conversation on, in `vos` or `usted`. */
const announcements = [
  // `Lo derivé`, `derivé tu consulta`, `te voy a derivar`.
  word(String.raw`deriv(?:é|e|amos|o|ó|ado|ada|ar|ando)`),
  // `Ya se lo pasé`, `se lo pasé al equipo`, `se lo pasé para que…`, but not
  // `te lo paso al martes` nor `para el martes`, a move.
  word(String.raw`(?:se|te|le)\s+l[oa]s?\s+pas(?:é|e|amos|o)`) +
    String.raw`(?=\s*$|\s+para\s*$|\s+(?:a|al|a la|con)\s+${word(person)})`,
  // `Pasé tu consulta`, `le pasé su mensaje`.
  word(String.raw`pas(?:é|e|amos|o)\s+(?:tu|su)\s+(?:consulta|mensaje|pedido|caso|pregunta)`),
  // `Te paso con recepción`.
  word(String.raw`(?:te|le|lo|la)\s+pas(?:é|e|amos|o)\s+con`) + String.raw`\s+${word(person)}`,
  // `Te va a contactar alguien`, `le van a escribir`.
  word(
    String.raw`(?:te|le|lo|la|los|las)\s+(?:va|van)\s+a\s+(?:contactar|escribir|responder|comunicar)`,
  ),
  // `Te van a llamar desde recepción`, but not `te van a llamar por tu nombre`.
  word(String.raw`(?:te|le|lo|la)\s+(?:va|van)\s+a\s+llamar`) +
    String.raw`\s+(?:(?:de|del|desde)\s+)?${word(`${person}|(?:el )?consultorio`)}`,
  // `Se van a comunicar con vos`.
  word(String.raw`se\s+(?:va|van)\s+a\s+(?:comunicar|contactar|poner\s+en\s+contacto)`),
  // `Le avisé al equipo`.
  word(String.raw`avis(?:é|e|amos)\s+(?:a|al|a la)`) + String.raw`\s+${word(person)}`,
].map((source) => new RegExp(source, "iu"));

/** A word that negates what follows it in its clause: `no te va a contactar nadie` announces nothing. */
const negation = new RegExp(word("no|nunca|tampoco|nadie|ni"), "iu");

/** Whether `pattern` matches `clause` with no negation before the match. */
function saysUnnegated(clause: string, pattern: RegExp) {
  const found = pattern.exec(clause);
  return found !== null && !negation.test(clause.slice(0, found.index));
}

/**
 * Whether `reply` says it passed the conversation on to a person
 * (docs/domain/assistant.md § Handoff), in a clause that does not negate it
 * first: `ya se lo pasé para que no esperes` does, and so does `no te
 * preocupes que ya se lo pasé`, whose `que` starts a clause.
 */
export function announcesHandoff(reply: string) {
  return reply
    .split(/[.!?;,\n]+|\s+(?:que|y)(?!\p{L})/iu)
    .map((clause) => clause.trim())
    .some((clause) => announcements.some((pattern) => saysUnnegated(clause, pattern)));
}
