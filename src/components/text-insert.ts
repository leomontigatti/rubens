/** Where the cursor or the selection sits in a text box: the offsets it spans. */
export interface TextSelection {
  start: number;
  end: number;
}

/** `value` with `text` written in over `selection`, and where the cursor lands after it. */
export function insertText(value: string, selection: TextSelection, text: string) {
  const { start, end } = selection;
  return { value: value.slice(0, start) + text + value.slice(end), cursor: start + text.length };
}
