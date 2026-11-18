// How a person's name is saved (docs/domain/patients.md).

const locale = "es-AR";

const particles = new Set(["de", "del", "la", "las", "los", "y"]);

function capitalized(word: string): string {
  return word
    .toLocaleLowerCase(locale)
    .replace(
      /(^|[-'’])(.)/gu,
      (_, before: string, first: string) => `${before}${first.toLocaleUpperCase(locale)}`,
    );
}

function titleCase(value: string, { leadingParticle }: { leadingParticle: boolean }): string {
  // Composed (NFC), so a pasted decomposed accent is the same letter as a typed one.
  const words = value.normalize("NFC").trim().split(/\s+/u).filter(Boolean);
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
