import { withoutMark } from "#/lib/assistant.ts";

// A patient's WhatsApp reactions (docs/domain/assistant.md § Proposals): each
// is a message of its own, Meta's `reaction`, whose `text` is the emoji and
// whose `reactsTo` is the message it reacts to. A later reaction to the same
// message replaces it, and one with no emoji takes it back, as WhatsApp shows.

interface Reacting {
  type: string;
  reactsTo: string | null;
  text: string | null;
}

export const reactionType = "reaction";

/** Whether `message` takes back the patient's reaction: underthing ignores it but for what it removes. */
export function takesBack(message: Omit<Reacting, "reactsTo">) {
  return message.type === reactionType && !message.text;
}

/**
 * The reaction each message shows, by its WhatsApp id, from a conversation's
 * messages oldest first: the latest one to it, unless that took it back.
 */
export function liveReactions<Message extends Reacting>(messages: Message[]) {
  const live = new Map<string, Message>();
  for (const message of messages) {
    if (message.type !== reactionType || !message.reactsTo) {
      continue;
    }
    if (takesBack(message)) {
      live.delete(message.reactsTo);
    } else {
      live.set(message.reactsTo, message);
    }
  }
  return live;
}

/**
 * A reaction as the model reads it, with the words of the message it reacts
 * to, or `null` when it cannot quote them (one not stored, or with no words).
 */
export function reactionLine(emoji: string, target: string | null) {
  return target === null
    ? `[reaccionó ${withoutMark(emoji)} a un mensaje]`
    : `[reaccionó ${withoutMark(emoji)} al mensaje: «${withoutMark(target)}»]`;
}
