import { and, eq, like, or, sql } from "drizzle-orm";
import * as z from "zod";

import { parsePhone } from "#/lib/phones.ts";
import {
  matchFragments,
  normalizeText,
  similarityTo,
  wordMatches,
  wordsOf,
} from "#/lib/search-text.ts";

import type { Database } from "#/organization/database.ts";
import { patientColumns, toPatient } from "#/organization/patients.ts";
import type { ListedPatient } from "#/organization/patients.ts";
import { coverage, insurer, patient } from "#/organization/schema.ts";

// The search box as reception types. SQLite has neither `unaccent` nor
// `pg_trgm` (#135): the object keeps each patient's names normalized in
// `search_name`, narrows the rows in SQL to those that can match, and scores
// what is left in code, by trigrams as `pg_trgm` did.

const searchLimit = 20;

const searchOptionsSchema = z.object({
  query: z.string().max(200),
  includeInactive: z.boolean(),
});

export type SearchOptions = z.input<typeof searchOptionsSchema>;

/**
 * What a typed query looks for: its words, matched against the names; and,
 * when it is only digits and separators, those digits and the phone it reads
 * as.
 */
function searchTerms(query: string) {
  const words = wordsOf(normalizeText(query));
  const digits = query.replace(/[\s.()+-]/g, "");
  if (!/^\d+$/.test(digits)) {
    return { words, digits: null, phone: null };
  }
  const phone = parsePhone(query);
  return { words, digits, phone: phone.ok ? phone.phone : null };
}

type SearchTerms = ReturnType<typeof searchTerms>;

/** How a patient's document or phone matches the query's digits: wholly, in part, or not. */
function digitsMatch(
  row: { documentNumber: string | null; phone: string },
  { digits, phone }: SearchTerms,
): "exact" | "partial" | null {
  if (digits === null) {
    return null;
  }
  if (row.documentNumber === digits || row.phone === (phone ?? digits)) {
    return "exact";
  }
  return row.documentNumber?.includes(digits) || row.phone.includes(digits) ? "partial" : null;
}

const byName = new Intl.Collator("es", { sensitivity: "base" });

/**
 * Finds patients as reception types: every word of the query in any of their
 * names, in any order and with or without accents, a near miss included;
 * digits in their document or phone too. Best matches first, the first 20 of
 * them, with `more` when others match too.
 */
export function searchPatients(
  database: Database,
  options: SearchOptions,
): { ok: true; patients: ListedPatient[]; more: boolean } | { ok: false; reason: "invalidInput" } {
  const parsed = searchOptionsSchema.safeParse(options);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" };
  }
  const terms = searchTerms(parsed.data.query);
  const { words, digits, phone } = terms;
  if (words.length === 0) {
    return { ok: true, patients: [], more: false };
  }
  const similarity = similarityTo(words.join(" "));
  const padded = sql`' ' || ${patient.searchName} || ' '`;
  const couldMatch = and(
    ...words.map((word) =>
      or(...matchFragments(word).map((fragment) => sql`${padded} like ${`%${fragment}%`}`)),
    ),
  );
  const digitsCouldMatch = digits
    ? or(
        like(patient.documentNumber, `%${digits}%`),
        like(patient.phone, `%${digits}%`),
        phone ? eq(patient.phone, phone) : undefined,
      )
    : undefined;
  const scored = database
    .select({ ...patientColumns, insurerName: insurer.name, searchName: patient.searchName })
    .from(patient)
    .leftJoin(coverage, and(eq(coverage.patientId, patient.id), eq(coverage.primary, true)))
    .leftJoin(insurer, eq(insurer.id, coverage.insurerId))
    .where(
      and(
        parsed.data.includeInactive ? undefined : eq(patient.active, true),
        or(couldMatch, digitsCouldMatch),
      ),
    )
    .all()
    .flatMap(({ searchName, ...row }) => {
      const byDigits = digitsMatch(row, terms);
      if (!byDigits && !words.every((word) => wordMatches(word, searchName))) {
        return [];
      }
      return [{ row, score: byDigits === "exact" ? 1 : similarity(searchName) }];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        byName.compare(a.row.lastName, b.row.lastName) ||
        byName.compare(a.row.firstName, b.row.firstName),
    );
  return {
    ok: true,
    patients: scored.slice(0, searchLimit).map(({ row }) => toPatient(row)),
    more: scored.length > searchLimit,
  };
}
