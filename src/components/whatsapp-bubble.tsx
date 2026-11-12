import { cn } from "cn";
import type { ReactNode } from "react";

/**
 * A stretch of a WhatsApp chat as the patient's phone shows it: the messages
 * the organization sends, each a `WhatsappBubble`, and the patient's, each a
 * `PatientBubble`, on the chat's background, with a `WhatsappDay` where the
 * day changes.
 */
export function WhatsappChat(props: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={props.label}
      className="bg-sidebar flex flex-col gap-1 rounded-lg p-3"
    >
      {props.children}
    </div>
  );
}

/** The day the messages under it were sent, centred across the chat: `Hoy`, `Ayer`, `Martes 10 de noviembre`. */
export function WhatsappDay(props: { children: ReactNode }) {
  return (
    <p className="bg-card text-muted-foreground my-2 self-center rounded-md px-2 py-1 text-xs shadow-xs">
      {props.children}
    </p>
  );
}

interface BubbleProps {
  /** Who wrote it, above the words, when the chat holds more than one writer on this side. */
  author?: string;
  /** What follows the words, under them: its time, and its status. */
  footer?: ReactNode;
  /** What opens the message's media, between its words and its footer. */
  media?: ReactNode;
  children: ReactNode;
}

/**
 * One message the organization sends, in WhatsApp's own outgoing green, with
 * its line breaks kept as WhatsApp keeps them. `pending` is one that has not
 * gone yet, muted as WhatsApp shows a message waiting to send.
 */
export function WhatsappBubble(props: BubbleProps & { pending?: boolean }) {
  const { pending, ...bubble } = props;
  return (
    <Bubble
      {...bubble}
      className={cn(
        "bg-whatsapp-outgoing text-foreground self-end rounded-tr-none",
        pending && "opacity-70",
      )}
    />
  );
}

/** One message from the patient, on the other side of the chat; `highlighted` is one a link pointed at. */
export function PatientBubble(props: BubbleProps & { highlighted?: boolean }) {
  const { highlighted, ...bubble } = props;
  return (
    <Bubble
      {...bubble}
      className={cn(
        "bg-card text-card-foreground self-start rounded-tl-none",
        highlighted && "ring-primary ring-2",
      )}
    />
  );
}

function Bubble(props: BubbleProps & { className: string }) {
  return (
    <div className={cn("max-w-md rounded-lg px-3 py-2 text-sm shadow-xs", props.className)}>
      {props.author && <p className="text-xs font-medium">{props.author}</p>}
      <p className="wrap-break-word whitespace-pre-wrap">{props.children}</p>
      {props.media && <div className="mt-2">{props.media}</div>}
      {props.footer && (
        <div className="text-muted-foreground mt-1 flex items-center justify-end gap-1 text-xs">
          {props.footer}
        </div>
      )}
    </div>
  );
}
