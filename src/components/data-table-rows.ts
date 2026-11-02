import { folded } from "#/components/filter-groups.ts";

// The rows a client-side table shows for what is typed in its search box.

/** Rows whose text holds the query, ignoring case and accents; every row with no query. */
export function matchingRows<Row>(rows: Row[], text: (row: Row) => string, query: string): Row[] {
  const needle = folded(query.trim());
  return rows.filter((row) => folded(text(row)).includes(needle));
}
