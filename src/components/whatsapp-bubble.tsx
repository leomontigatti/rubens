import { cn } from "cn";
import type { ReactNode } from "react";

/**
 * A stretch of a WhatsApp chat as the patient's phone shows it: the messages
 * the organization sends, each a `WhatsappBubble`, and the patient's, each a
 * `PatientBubble`, on the chat's background.
 */
export function WhatsappChat(props: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={props.label}
      className="bg-muted flex flex-col gap-1 rounded-lg p-3"
    >
      {props.children}
    </div>
  );
}

interface BubbleProps {
  /** Who wrote it, above the words, when the chat holds more than one writer on this side. */
  author?: string;
  /** What follows the words, under them: its time, and its status. */
  footer?: ReactNode;
  children: ReactNode;
}

/** One message the organization sends, with its line breaks kept as WhatsApp keeps them. */
export function WhatsappBubble(props: BubbleProps) {
  return <Bubble {...props} className="bg-card text-card-foreground self-end rounded-tr-none" />;
}

/** One message from the patient, on the other side of the chat. */
export function PatientBubble(props: BubbleProps) {
  return (
    <Bubble
      {...props}
      className="bg-secondary text-secondary-foreground self-start rounded-tl-none"
    />
  );
}

function Bubble(props: BubbleProps & { className: string }) {
  return (
    <div className={cn("max-w-md rounded-lg px-3 py-2 text-sm shadow-xs", props.className)}>
      {props.author && <p className="text-xs font-medium">{props.author}</p>}
      <p className="wrap-break-word whitespace-pre-wrap">{props.children}</p>
      {props.footer && (
        <div className="text-muted-foreground mt-1 flex items-center justify-end gap-2 text-xs">
          {props.footer}
        </div>
      )}
    </div>
  );
}
