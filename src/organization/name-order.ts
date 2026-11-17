import { sql } from "drizzle-orm";
import type { SQL, SQLWrapper } from "drizzle-orm";

// People's names in the order Spanish sorts them, in SQL so a paged list can
// use it: SQLite compares bytes, so a lower-case particle (`de la Cruz`) or an
// accented capital (`Álvarez`) would sort after `Z`.

// SQLite's `lower` folds ASCII only; these fold the accented letters a surname
// here carries, Spanish and the immigrant ones (`Gonçalves`, `Pietrà`), each
// in both cases. `ñ` becomes `n~`, which sorts after every `n…` and before
// `o` (`~` follows the letters), where Spanish puts it.
const letters: [string[], string][] = [
  [["á", "à", "â", "ä", "ã", "å"], "a"],
  [["é", "è", "ê", "ë"], "e"],
  [["í", "ì", "î", "ï"], "i"],
  [["ó", "ò", "ô", "ö", "õ"], "o"],
  [["ú", "ù", "û", "ü"], "u"],
  [["ç"], "c"],
  [["ñ"], "n~"],
];

const folds = letters.flatMap(([accented, plain]) =>
  [...accented, ...accented.map((letter) => letter.toUpperCase())].map(
    (letter) => [letter, plain] as const,
  ),
);

// The folds are written into the SQL, not bound: the object's SQLite binds at
// most 100 parameters a query, and a list's ids already take most of them.
const literal = (text: string) => sql.raw(`'${text}'`);

/** A name column folded for ordering: lower case, accents off, `ñ` after `n`. */
function foldedName(column: SQLWrapper): SQL {
  return folds.reduce(
    (folded, [from, to]) => sql`replace(${folded}, ${literal(from)}, ${literal(to)})`,
    sql`lower(${column})`,
  );
}

export function byName(lastName: SQLWrapper, firstName: SQLWrapper): SQL[] {
  return [foldedName(lastName), foldedName(firstName)];
}
