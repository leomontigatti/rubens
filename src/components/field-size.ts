// How wide a form's field is: rows of six columns from `md` up, the whole
// width on a phone (docs/agents/style-guide.md § Forms).

/** `small` takes two columns, three to a row; `medium` three, two to a row; `large` the row. */
export type FieldSize = "small" | "medium" | "large";

/** Where a field sits in its form's grid; a form names only what differs from the default. */
export interface FieldPlace {
  size?: FieldSize;
  /** The field starts a new subject, so it starts a new row. */
  startsRow?: boolean;
}

/** A number or a time is short; a text, a date, or a date and time is not. */
export const textFieldSize = (type: string | undefined): FieldSize =>
  type === "number" || type === "time" ? "small" : "medium";

/** What a field's outer element carries, which the grid reads. */
export const placeAttributes = (place: FieldPlace, fallback: FieldSize) => ({
  "data-size": place.size ?? fallback,
  "data-starts-row": place.startsRow || undefined,
});
