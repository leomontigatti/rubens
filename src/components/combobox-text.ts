// The text in a `ComboboxField`'s box, as Base UI changes it. The box shows
// either the record picked or what is being typed, never both.

export interface ComboboxTextChange {
  text: string;
  /** What to search for: only typing searches. */
  query: string;
  /** Typing over the name of the record picked drops the pick. */
  dropPick: boolean;
}

/** What a change to the box's text does, by why Base UI made it; `null` keeps the box as it is. */
export function comboboxTextChange(
  text: string,
  reason: string,
  picked: boolean,
): ComboboxTextChange | null {
  // The list stays closed while a search runs, and Base UI would wipe what was
  // typed when it closes or on Escape. With a record picked, Escape clears both.
  if (reason === "input-clear" || (reason === "escape-key" && !picked)) {
    return null;
  }
  const typing = reason === "input-change";
  return { text, query: typing ? text : "", dropPick: typing && picked };
}
