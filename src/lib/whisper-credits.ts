// Whisper, on a silent or noisy voice note, can write out the credits of the
// videos it was trained on instead of nothing (#400). Those lines are never the
// patient's words: a transcript that holds only them is a transcript with no
// words, which `voice-notes.ts` treats as a note nobody could understand. The
// Amara line is unmistakable, so it is cut wherever it stands, also run on after
// the patient's words with no stop. The video phrases are words a patient could
// say, so beside other words they are kept as heard.

const amaraCredit =
  /¡?(?:subt[ií]tul(?:os|ado)\s+(?:(?:realizados|hechos)\s+)?por\s+la\s+comunidad\s+de\s+amara\.org|\bamara\.org\b)[.!]*/giu;
const videoCredit = /gracias\s+por\s+ver\s+el\s+v[ií]deo|suscr[ií]bete\s+al\s+canal/giu;

const hasWords = (text: string) => /[\p{L}\p{N}]/u.test(text);

/** `transcript` without Whisper's credit lines, trimmed: empty when nothing the patient said is left. */
export function withoutWhisperCredits(transcript: string) {
  // Composed, so an accent written as its own mark still matches `[ií]`.
  const left = transcript.normalize("NFC").replace(amaraCredit, "").trim();
  return hasWords(left.replace(videoCredit, "")) ? left : "";
}
