import { Fragment, useState } from "react";

import {
  PatientBubble,
  WhatsappBubble,
  WhatsappChat,
  WhatsappDay,
} from "#/components/whatsapp-bubble.tsx";
import { WhatsappStatus } from "#/components/whatsapp-status.tsx";
import { formatDateTime } from "#/lib/dates.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import type { InboxMessage } from "#/organization/inbox.ts";
import type { QueuedReopen, ShownLateReply, WithdrawnReply } from "#/organization/late-replies.ts";
import type { ShownOptOut } from "#/organization/opt-out-holds.ts";

import {
  byDay,
  messageClock,
  messageSender,
  messageText,
} from "#/routes/_app/conversaciones/-labels.ts";
import { LateReplyBubble } from "#/routes/_app/conversaciones/-late-replies.tsx";
import { MessageMediaControl } from "#/routes/_app/conversaciones/-media.tsx";
import { MessageStatus } from "#/routes/_app/conversaciones/-messages.tsx";
import { OptOutRows } from "#/routes/_app/conversaciones/-opt-outs.tsx";

// The conversation as the patient's phone shows it, by day, oldest first:
// the messages, and what has not gone yet where it was written, the reopen
// template before the replies that wait behind it; where a waiting reply
// was withdrawn, a muted line saying who withdrew it, without its words; and
// under a reply that looked like an opt-out, its decision (`-opt-outs.tsx`).
// The message a link points at is marked out and scrolled to.

type ChatItem =
  | { kind: "message"; at: number; message: InboxMessage }
  | { kind: "reopen"; at: number; reopen: QueuedReopen }
  | { kind: "lateReply"; at: number; reply: ShownLateReply }
  | { kind: "withdrawn"; at: number; reply: WithdrawnReply };

export function ConversationChat(props: {
  conversationId: string;
  messages: InboxMessage[];
  queuedReopen: QueuedReopen | null;
  lateReplies: ShownLateReply[];
  withdrawnReplies: WithdrawnReply[];
  optOuts: ShownOptOut[];
  /** The message a link pointed at, such as an opt-out's notification. */
  highlighted?: string;
}) {
  // The day `Hoy` names, read once: a page left open past midnight keeps its labels until it reloads.
  const [now] = useState(() => Date.now());
  const items: ChatItem[] = [
    ...props.messages.map((message) => ({
      kind: "message" as const,
      at: message.sentAt,
      message,
    })),
    ...(props.queuedReopen
      ? [{ kind: "reopen" as const, at: props.queuedReopen.queuedAt, reopen: props.queuedReopen }]
      : []),
    ...props.lateReplies.map((reply) => ({
      kind: "lateReply" as const,
      at: reply.writtenAt,
      reply,
    })),
    ...props.withdrawnReplies.map((reply) => ({
      kind: "withdrawn" as const,
      at: reply.withdrawnAt,
      reply,
    })),
  ];
  // A stable sort: the reopen template, queued with the first reply behind it, stays before it.
  items.sort((first, second) => first.at - second.at);
  return (
    <WhatsappChat label="Mensajes">
      {byDay(items, (item) => item.at, now).map((day, index) => (
        <Fragment key={`${index}-${day.label}`}>
          <WhatsappDay>{day.label}</WhatsappDay>
          {day.items.map((item) => (
            <ChatBubble
              key={`${item.kind}-${idOf(item)}`}
              item={item}
              conversationId={props.conversationId}
              now={now}
              optOuts={props.optOuts}
              highlighted={props.highlighted}
            />
          ))}
        </Fragment>
      ))}
    </WhatsappChat>
  );
}

function idOf(item: ChatItem) {
  if (item.kind === "message") {
    return item.message.id;
  }
  return item.kind === "reopen" ? item.reopen.id : item.reply.id;
}

function ChatBubble({
  item,
  ...shown
}: {
  item: ChatItem;
  conversationId: string;
  now: number;
  optOuts: ShownOptOut[];
  highlighted: string | undefined;
}) {
  if (item.kind === "lateReply") {
    return <LateReplyBubble reply={item.reply} />;
  }
  if (item.kind === "withdrawn") {
    return (
      <p className="text-muted-foreground my-1 self-center text-xs">
        {item.reply.writer} retiró una respuesta ·{" "}
        {formatDateTime(item.reply.withdrawnAt, defaultTimeZone)}
      </p>
    );
  }
  if (item.kind === "reopen") {
    return (
      <WhatsappBubble
        author="Plantilla"
        pending
        footer={
          <>
            {messageClock(item.at)}
            <WhatsappStatus status="queued" />
          </>
        }
      >
        {item.reopen.text}
      </WhatsappBubble>
    );
  }
  return <ChatMessage message={item.message} {...shown} />;
}

/** A message, with an opt-out's decision under it, marked out and scrolled to when a link pointed at it. */
function ChatMessage({
  optOuts,
  highlighted,
  ...bubble
}: {
  message: InboxMessage;
  conversationId: string;
  now: number;
  optOuts: ShownOptOut[];
  highlighted: string | undefined;
}) {
  const under = optOuts.filter((one) => one.messageId === bubble.message.id);
  const marked = highlighted === bubble.message.id;
  if (under.length === 0 && !marked) {
    return <MessageBubble {...bubble} />;
  }
  return (
    <div ref={marked ? scrollTo : undefined} className="flex flex-col items-start gap-1">
      <MessageBubble {...bubble} highlighted={marked} />
      <OptOutRows optOuts={under} />
    </div>
  );
}

/** Scrolls the message a link pointed at into view, once it is on the page. */
function scrollTo(node: HTMLElement | null) {
  node?.scrollIntoView({ block: "center" });
}

function MessageBubble({
  message,
  conversationId,
  now,
  highlighted,
}: {
  message: InboxMessage;
  conversationId: string;
  now: number;
  highlighted?: boolean;
}) {
  const text = <span>{messageText(message)}</span>;
  const footer = (
    <>
      {messageClock(message.sentAt)}
      <MessageStatus message={message} />
    </>
  );
  const sender = messageSender(message);
  const { media } = message;
  const opens = media && (
    <MessageMediaControl
      conversationId={conversationId}
      message={{ ...message, media }}
      now={now}
    />
  );
  return sender === null ? (
    <PatientBubble footer={footer} media={opens} highlighted={highlighted}>
      {text}
    </PatientBubble>
  ) : (
    <WhatsappBubble author={sender} footer={footer}>
      {text}
    </WhatsappBubble>
  );
}
