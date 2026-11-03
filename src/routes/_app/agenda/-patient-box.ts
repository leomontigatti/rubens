// The text in booking's patient combobox, as Base UI changes it. The box shows
// either the patient picked or what is being typed, never both.

export interface PatientBoxChange {
  text: string;
  /** What to search for: only typing searches. */
  query: string;
  /** Typing over a picked patient's name drops the pick. */
  dropPick: boolean;
}

/** What a change to the box's text does, by why Base UI made it; `null` keeps the box as it is. */
export function patientBoxChange(
  text: string,
  reason: string,
  picked: boolean,
): PatientBoxChange | null {
  // The list stays closed while a search runs, and Base UI would wipe what was
  // typed when it closes or on Escape. With a patient picked, Escape clears both.
  if (reason === "input-clear" || (reason === "escape-key" && !picked)) {
    return null;
  }
  const typing = reason === "input-change";
  return { text, query: typing ? text : "", dropPick: typing && picked };
}
