import { sql } from "drizzle-orm";
import type { SQL, SQLWrapper } from "drizzle-orm";

// People's names in the order Spanish sorts them, in SQL so a paged list can
// use it: SQLite compares bytes, so a lower-case particle (`de la Cruz`) or an
// accented capital (`Álvarez`) would sort after `Z`.

// SQLite's `lower` folds ASCII only; these fold the rest of Spanish. `ñ` becomes
// `n~`, which sorts after every `n…` and before `o` (`~` follows the letters),
// where Spanish puts it.
const folds: [string, string][] = [
  ["Á", "a"],
  ["É", "e"],
  ["Í", "i"],
  ["Ó", "o"],
  ["Ú", "u"],
  ["Ü", "u"],
  ["Ñ", "n~"],
  ["á", "a"],
  ["é", "e"],
  ["í", "i"],
  ["ó", "o"],
  ["ú", "u"],
  ["ü", "u"],
  ["ñ", "n~"],
];

/** A name column folded for ordering: lower case, accents off, `ñ` after `n`. */
function foldedName(column: SQLWrapper): SQL {
  return folds.reduce(
    (folded, [from, to]) => sql`replace(${folded}, ${from}, ${to})`,
    sql`lower(${column})`,
  );
}

/** The `orderBy` of a list of people: last name, then first name, both folded. */
export function byName(lastName: SQLWrapper, firstName: SQLWrapper): SQL[] {
  return [foldedName(lastName), foldedName(firstName)];
}
