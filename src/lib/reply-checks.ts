// The fixed checks every assistant reply passes before it goes out
// (docs/domain/assistant.md § Communication rules).

/** The longest reply the assistant sends, in characters, before it is split into messages. */
export const maxReplyLength = 600;

const variationSelector = String.raw`\p{Variation_Selector}`;
const enclosingMark = String.raw`\p{Me}`;
const keycap = String.raw`[0-9#*]${variationSelector}?${enclosingMark}`;

const pictographsAlsoText = "©®™←-⇿➡⬅-⬇";
const emojiPictograph = String.raw`(?![${pictographsAlsoText}])\p{Extended_Pictographic}`;

const emojiPresentation = String.raw`\p{Emoji_Presentation}`;
const skinTone = String.raw`\p{Emoji_Modifier}`;
const flagLetter = String.raw`\p{Regional_Indicator}`;
const joiner = String.raw`\p{Join_Control}`;
const flagTag = String.raw`\u{E0020}-\u{E007F}`;
const emojiBuildingBlock = `[${emojiPresentation}${skinTone}${flagLetter}${joiner}${variationSelector}${enclosingMark}${flagTag}]`;

const emojiPiece = [keycap, emojiPictograph, emojiBuildingBlock].join("|");

const emojiRun = new RegExp(`(?:${emojiPiece})+`, "gu");

const lastCharacterOfText = String.raw`[\p{L}\p{N}\p{M}\p{Pe}\p{Pf}.,;:!?…%]`;
const straightQuoteOrWhatsAppMark = `["'*_~]`;
const endsText = new RegExp(`${lastCharacterOfText}${straightQuoteOrWhatsAppMark}*$`, "u");

// Bounded, so a long reply with many emojis is not scanned again per run.
const codeUnitsBeforeRun = 16;

function inPlaceOf(run: string, at: number, text: string) {
  const endsBefore = endsText.test(text.slice(Math.max(0, at - codeUnitsBeforeRun), at));
  const startsText = /^[\p{L}\p{N}]/u.test(text.slice(at + run.length));
  const between = endsBefore && startsText;
  return between ? " " : "";
}

const openingMarks = /[¿¡]/g;

export function hasOpeningMark(text: string) {
  return new RegExp(openingMarks.source, "u").test(text);
}

export function hasEmoji(text: string) {
  return new RegExp(emojiPiece, "u").test(text);
}

export type ReplyCheck =
  | { ok: true; text: string }
  | { ok: false; reason: "tooLong" | "empty"; text: string; length: number };

function corrected(text: string) {
  return text
    .replace(openingMarks, "")
    .replace(emojiRun, inPlaceOf)
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
