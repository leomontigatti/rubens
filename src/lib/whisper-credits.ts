// Whisper's made-up credit lines in a voice note's transcript
// (docs/domain/assistant.md § For patients): a transcript of only them has no
// words, which `voice-notes.ts` treats as a note nobody could understand.

const amaraCredit =
  /¡?(?:subt[ií]tul(?:os|ado)\s+(?:(?:realizados|hechos)\s+)?por\s+la\s+comunidad\s+de\s+amara\.org|\bamara\.org\b)[.!]*/giu;
const videoCredit = /gracias\s+por\s+ver\s+el\s+v[ií]deo|suscr[ií]bete\s+al\s+canal/giu;

const hasWords = (text: string) => /[\p{L}\p{N}]/u.test(text);

export function withoutWhisperCredits(transcript: string) {
  // Composed, so an accent written as its own mark still matches `[ií]`.
  const left = transcript.normalize("NFC").replace(amaraCredit, "").trim();
  return hasWords(left.replace(videoCredit, "")) ? left : "";
}
