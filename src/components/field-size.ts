// How wide a form's field is: rows of twelve columns from `md` up, the whole
// width on a phone (docs/agents/style-guide.md § Forms).

/** `quarter` takes three columns, four to a row; `half` six, two to a row; `full` the row. */
export type FieldSize = "quarter" | "half" | "full";

/** Where a field sits in its form's grid; a form names only what differs from the default. */
export interface FieldPlace {
  size?: FieldSize;
  /** The field starts a new subject, so it starts a new row. */
  startsRow?: boolean;
}

/** What a field's outer element carries, which the grid reads. */
export const placeAttributes = (place: FieldPlace, fallback: FieldSize) => ({
  "data-size": place.size ?? fallback,
  "data-starts-row": place.startsRow || undefined,
});
