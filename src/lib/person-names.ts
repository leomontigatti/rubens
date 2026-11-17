// How a person's name is saved: in Spanish title case, whatever case it was
// typed in, so "juan DE LA cruz" and "Juan de la Cruz" are the same name on
// every screen and message. A patient's chosen name is kept as typed.

const locale = "es-AR";

/** The words that stay in lower case inside a name: "María de los Ángeles". */
const particles = new Set(["de", "del", "la", "las", "los", "y"]);

/** A word in lower case, its first character and the one after each hyphen or apostrophe capitalised. */
function capitalized(word: string): string {
  return word
    .toLocaleLowerCase(locale)
    .replace(
      /(^|[-'’])(.)/gu,
      (_, before: string, first: string) => `${before}${first.toLocaleUpperCase(locale)}`,
    );
}

function titleCase(value: string, { leadingParticle }: { leadingParticle: boolean }): string {
  const words = value.trim().split(/\s+/u).filter(Boolean);
  return words
    .map((word, index) => {
      const lower = word.toLocaleLowerCase(locale);
      const particle = particles.has(lower) && (index > 0 || leadingParticle);
      return particle ? lower : capitalized(word);
    })
    .join(" ");
}

/** A first name, or a guardian's whole name: `juan DE LA cruz` is `Juan de la Cruz`. */
export function toPersonName(value: string): string {
  return titleCase(value, { leadingParticle: false });
}

/** A last name, whose leading particle stays in lower case: `DE LA CRUZ` is `de la Cruz`. */
export function toPersonLastName(value: string): string {
  return titleCase(value, { leadingParticle: true });
}
