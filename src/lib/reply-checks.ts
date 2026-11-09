// The fixed checks every assistant reply passes before it goes out
// (docs/domain/assistant.md § Communication rules): no opening `¿` or `¡`, no
// emojis, a maximum length. They always hold and nobody edits them, whatever
// the organization's communication rules say. The assistant's send path calls
// `checkReply()`: what it can correct, it corrects; a reply too long, or left
// empty, it reports for the caller to rewrite or hand off.

/** The longest reply the assistant sends, in characters, before it is split into messages. */
export const maxReplyLength = 600;

// One piece of an emoji: a keycap (a digit, `#` or `*` with its enclosing
// mark), taken whole so its digit goes too; any pictograph but `©`, `®`, `™`
// and the arrows, which are text symbols too; and the pieces emojis are built
// from (joiners, variation selectors, skin tones, a flag's letters and tags).
const emojiPiece = String.raw`[0-9#*]\p{Variation_Selector}?\p{Me}|(?![©®™←-⇿➡⬅-⬇])\p{Extended_Pictographic}|[\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Regional_Indicator}\p{Join_Control}\p{Variation_Selector}\p{Me}\u{E0020}-\u{E007F}]`;

const emoji = new RegExp(emojiPiece, "gu");

/** Emojis between two words, which a space keeps apart once the emojis go. */
const emojisBetweenWords = new RegExp(
  String.raw`(?<=[\p{L}\p{N}])(?:${emojiPiece})+(?=[\p{L}\p{N}])`,
  "gu",
);

const openingMarks = /[¿¡]/g;

export type ReplyCheck =
  | { ok: true; text: string }
  | { ok: false; reason: "tooLong" | "empty"; text: string; length: number };

/** `text` with the opening marks and the emojis taken out, and the spaces they leave tidied. */
function corrected(text: string) {
  return text
    .replace(openingMarks, "")
    .replace(emojisBetweenWords, " ")
    .replace(emoji, "")
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]{2,}/g, " ")
        .replace(/ +([.,;:!?])/g, "$1")
        .trim(),
    )
    .join("\n")
    .trim();
}

/** Corrects `text` by the fixed checks, and says whether what is left can be sent. */
export function checkReply(text: string): ReplyCheck {
  const fixed = corrected(text);
  const { length } = fixed;
  if (length === 0) {
    return { ok: false, reason: "empty", text: fixed, length };
  }
  if (length > maxReplyLength) {
    return { ok: false, reason: "tooLong", text: fixed, length };
  }
  return { ok: true, text: fixed };
}
