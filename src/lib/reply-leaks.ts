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
// (`turn-replies.ts`).

const toolNames = new RegExp(
  `(?<!\\w)(?:${Object.keys(assistantToolSchemas).join("|")})(?!\\w)`,
  "iu",
);

const marks = [
  newMessagesMark,
  withdrawnReplyNote,
  staffReplyNote,
  longPauseNote,
  reactionMark,
].map((mark) => mark.toLowerCase());

export function leaksInternals(reply: string) {
  const lower = reply.toLowerCase();
  return toolNames.test(reply) || marks.some((mark) => lower.includes(mark));
}

const wholeWord = (source: string) => `(?<!\\p{L})(?:${source})(?!\\p{L})`;

const nonPractitionerStaff = String.raw`una persona|alguien|(?:el |nuestro )?equipo|(?:la )?recepci[oó]n|(?:la )?secretar[ií]a`;

const person = String.raw`${nonPractitionerStaff}|(?:el |la )?(?:profesional|doctora?|dra?\.?)`;

// `para que…` reaches it as a clause ending in `para`: `announcesHandoff` splits at `que`.
const pastPassOn =
  wholeWord(String.raw`se\s+l[oa]s?\s+pas(?:é|amos)`) +
  String.raw`(?=\s*$|\s+para\s*$|\s+as[ií](?!\p{L}))`;

const announcements = [
  wholeWord(String.raw`deriv(?:é|e|amos|o|ó|ado|ada|ar|ando)`),
  pastPassOn,
  wholeWord(String.raw`(?:se|te|le)\s+l[oa]s?\s+pas(?:é|amos|o)`) +
    String.raw`(?=\s+(?:a|al|a la|con)\s+${wholeWord(person)})`,
  wholeWord(String.raw`pas(?:é|e|amos|o)\s+(?:tu|su)\s+(?:consulta|mensaje|pedido|caso|pregunta)`),
  wholeWord(String.raw`(?:te|le|lo|la)\s+pas(?:é|e|amos|o)\s+con`) +
    String.raw`\s+${wholeWord(person)}`,
  wholeWord(
    String.raw`(?:te|le|lo|la|los|las)\s+(?:va|van)\s+a\s+(?:contactar|escribir|responder|comunicar)`,
  ),
  wholeWord(String.raw`(?:te|le|lo|la)\s+(?:va|van)\s+a\s+llamar`) +
    String.raw`\s+(?:(?:de|del|desde)\s+)?${wholeWord(`${nonPractitionerStaff}|(?:el )?consultorio`)}`,
  wholeWord(String.raw`(?:te|le|lo|la)\s+van\s+a\s+llamar`) + String.raw`(?=\s*$)`,
  wholeWord(String.raw`se\s+(?:va|van)\s+a\s+(?:comunicar|contactar|poner\s+en\s+contacto)`),
  wholeWord(String.raw`avis(?:é|e|amos)\s+(?:a|al|a la)`) + String.raw`\s+${wholeWord(person)}`,
].map((source) => new RegExp(source, "iu"));

const negation = new RegExp(wholeWord("no|nunca|tampoco|nadie|ni"), "iu");

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
