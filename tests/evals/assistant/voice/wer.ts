// Word error rate between the words spoken and a transcript: word-level edit
// distance over the number of words spoken. Case, accents and punctuation do not
// count, since the assistant reads `cancelame` and `Cancelame.` alike, and neither
// does writing a number in words or digits: `diez y media` and `10:30` are both
// `10 30`.

const numberWords = [
  "cero",
  "uno",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
  "diez",
  "once",
  "doce",
  "trece",
  "catorce",
  "quince",
  "dieciseis",
  "diecisiete",
  "dieciocho",
  "diecinueve",
  "veinte",
  "veintiuno",
  "veintidos",
  "veintitres",
  "veinticuatro",
  "veinticinco",
  "veintiseis",
  "veintisiete",
  "veintiocho",
  "veintinueve",
  "treinta",
];

function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\by media\b/g, "30")
    .replace(/\by cuarto\b/g, "15")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const number = numberWords.indexOf(word);
      return number === -1 ? word : String(number);
    });
}

export function wordErrorRate(spoken: string, transcript: string): number {
  const reference = words(spoken);
  const hypothesis = words(transcript);
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, index) => index);
  for (let row = 1; row <= reference.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= hypothesis.length; column += 1) {
      const substitution =
        (previous[column - 1] ?? 0) + (reference[row - 1] === hypothesis[column - 1] ? 0 : 1);
      current.push(
        Math.min(substitution, (previous[column] ?? 0) + 1, (current[column - 1] ?? 0) + 1),
      );
    }
    previous = current;
  }
  return (previous[hypothesis.length] ?? 0) / Math.max(1, reference.length);
}
