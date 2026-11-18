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

/** `source` as a whole word or phrase: no letter right before or after it. */
const word = (source: string) => `(?<!\\p{L})(?:${source})(?!\\p{L})`;

/** Whom a conversation is passed to, as a reply names them, but for the practitioner. */
const staff = String.raw`una persona|alguien|(?:el |nuestro )?equipo|(?:la )?recepci[oó]n|(?:la )?secretar[ií]a`;

const person = String.raw`${staff}|(?:el |la )?(?:profesional|doctora?|dra?\.?)`;

const announcements = [
  word(String.raw`deriv(?:é|e|amos|o|ó|ado|ada|ar|ando)`),
  // `Ya se lo pasé`, `se lo pasé así te responden`, and `se lo pasé para que…`,
  // whose `que` ends the clause (`announcesHandoff`): done, and to them. Not
  // `te los paso para que elijas`, the patient's options, nor `querés que se
  // lo pase`, an offer: an unaccented `pase` is the subjunctive.
  word(String.raw`se\s+l[oa]s?\s+pas(?:é|amos)`) +
    String.raw`(?=\s*$|\s+para\s*$|\s+as[ií](?!\p{L}))`,
  word(String.raw`(?:se|te|le)\s+l[oa]s?\s+pas(?:é|amos|o)`) +
    String.raw`(?=\s+(?:a|al|a la|con)\s+${word(person)})`,
  word(String.raw`pas(?:é|e|amos|o)\s+(?:tu|su)\s+(?:consulta|mensaje|pedido|caso|pregunta)`),
  word(String.raw`(?:te|le|lo|la)\s+pas(?:é|e|amos|o)\s+con`) + String.raw`\s+${word(person)}`,
  word(
    String.raw`(?:te|le|lo|la|los|las)\s+(?:va|van)\s+a\s+(?:contactar|escribir|responder|comunicar)`,
  ),
  // `Te van a llamar desde recepción`, but not `te van a llamar por tu nombre`
  // nor `te va a llamar la doctora`, who calls a waiting patient in.
  word(String.raw`(?:te|le|lo|la)\s+(?:va|van)\s+a\s+llamar`) +
    String.raw`\s+(?:(?:de|del|desde)\s+)?${word(`${staff}|(?:el )?consultorio`)}`,
  word(String.raw`(?:te|le|lo|la)\s+van\s+a\s+llamar`) + String.raw`(?=\s*$)`,
  word(String.raw`se\s+(?:va|van)\s+a\s+(?:comunicar|contactar|poner\s+en\s+contacto)`),
  word(String.raw`avis(?:é|e|amos)\s+(?:a|al|a la)`) + String.raw`\s+${word(person)}`,
].map((source) => new RegExp(source, "iu"));

const negation = new RegExp(word("no|nunca|tampoco|nadie|ni"), "iu");

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
