// How the patient search compares text (`src/organization/patient-search.ts`):
// without accents, case or extra spaces, and by trigrams, as Postgres's
// `pg_trgm` did before the port (#135), so a near miss still matches.

/** `value` without accents, in lower case, its spaces collapsed: "  Núñez " is "nunez". */
export function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** The words of normalized text: its runs of letters and digits. */
export function wordsOf(text: string): string[] {
  return text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * The trigrams of each word, padded as `pg_trgm` pads them: two spaces before
 * the word and one after, so a word's start weighs more than its end.
 */
function trigrams(text: string): Set<string> {
  const found = new Set<string>();
  for (const word of wordsOf(text)) {
    const padded = `  ${word} `;
    for (let index = 0; index + 3 <= padded.length; index += 1) {
      found.add(padded.slice(index, index + 3));
    }
  }
  return found;
}

function shared(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const trigram of a) {
    if (b.has(trigram)) {
      count += 1;
    }
  }
  return count;
}

/**
 * How alike a text is to normalized `query`, 0 to 1: shared trigrams over all
 * of them, as `pg_trgm`'s `similarity`. The query's trigrams are taken once.
 */
export function similarityTo(query: string): (text: string) => number {
  const wanted = trigrams(query);
  return (text) => {
    const found = trigrams(text);
    const common = shared(wanted, found);
    const all = wanted.size + found.size - common;
    return all === 0 ? 0 : common / all;
  };
}

// `pg_trgm`'s default `word_similarity_threshold`.
const nearMissThreshold = 0.6;

/**
 * Whether normalized `word` is in normalized `text`: inside it, or close to one
 * of its words, sharing most of the word's trigrams ("gonzales" is close to
 * "gonzalez", "gomes" to "gomez").
 */
export function wordMatches(word: string, text: string): boolean {
  if (text.includes(word)) {
    return true;
  }
  const wanted = trigrams(word);
  return wordsOf(text).some(
    (candidate) => shared(wanted, trigrams(candidate)) / wanted.size >= nearMissThreshold,
  );
}

/**
 * What a text `wordMatches` contains, as `like` fragments of the text padded
 * with a space each side: the word itself, or one of its trigrams. A text
 * with none of them cannot match the word, so a query can narrow the rows
 * before the code scores them. A word holds only letters and digits, so no
 * fragment is a `like` wildcard.
 */
export function matchFragments(word: string): string[] {
  return [word, ...[...trigrams(word)].map((trigram) => trigram.replace(/^ {2}/, " "))];
}
