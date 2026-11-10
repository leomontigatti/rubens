// How the assistant writes on WhatsApp (docs/domain/assistant.md § Pace): a
// reply goes out as up to three short messages, one per paragraph, each after
// a typing pause about as long as a person would take. Each message is billed
// (§ Costs), so splitting stops at three; a reply holding a proposal stays
// whole, so what the patient accepts is what they read.

/** The most messages one reply goes out as. */
const maxReplyMessages = 3;

/** The shortest typing pause, in milliseconds, for a message of a word or two. */
const shortestPause = 1_500;

/** Milliseconds of typing per character, on top of the shortest pause. */
const pausePerCharacter = 25;

/** The longest typing pause, in milliseconds: the patient is waiting for it. */
const longestPause = 6_000;

/**
 * The messages `reply` goes out as: one per paragraph (lines apart by a blank
 * line), the paragraphs past the third joined into the third; the whole reply
 * in one when `whole` asks for it.
 */
export function splitReply(reply: string, { whole }: { whole: boolean }): string[] {
  const paragraphs = reply
    .split(/\n[ \t]*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  if (whole || paragraphs.length <= 1) {
    return [reply.trim()];
  }
  const first = paragraphs.slice(0, maxReplyMessages - 1);
  const rest = paragraphs.slice(maxReplyMessages - 1);
  return rest.length > 0 ? [...first, rest.join("\n\n")] : first;
}

/** How long the assistant shows typing before it sends `message`, in milliseconds. */
export function typingPauseOf(message: string): number {
  return Math.min(longestPause, shortestPause + pausePerCharacter * message.length);
}
