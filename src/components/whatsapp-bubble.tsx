import type { ReactNode } from "react";

/**
 * A stretch of a WhatsApp chat as the patient's phone shows it: the messages
 * the organization sends, each a `WhatsappBubble`, on the chat's background.
 */
export function WhatsappChat(props: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={props.label}
      className="bg-muted flex flex-col items-end gap-1 rounded-lg p-3"
    >
      {props.children}
    </div>
  );
}

/** One message the organization sends, with its line breaks kept as WhatsApp keeps them. */
export function WhatsappBubble(props: { children: ReactNode }) {
  return (
    <p className="bg-card text-card-foreground max-w-md rounded-lg rounded-tr-none px-3 py-2 text-sm wrap-break-word whitespace-pre-wrap shadow-xs">
      {props.children}
    </p>
  );
}
