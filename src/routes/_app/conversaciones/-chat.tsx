import { Fragment, useState } from "react";

import {
  PatientBubble,
  WhatsappBubble,
  WhatsappChat,
  WhatsappDay,
} from "#/components/whatsapp-bubble.tsx";
import { WhatsappStatus } from "#/components/whatsapp-status.tsx";
import type { InboxMessage } from "#/organization/inbox.ts";
import type { QueuedReopen, ShownLateReply } from "#/organization/late-replies.ts";

import {
  byDay,
  messageClock,
  messageSender,
  messageText,
} from "#/routes/_app/conversaciones/-labels.ts";
import { LateReplyBubble } from "#/routes/_app/conversaciones/-late-replies.tsx";
import { MessageStatus } from "#/routes/_app/conversaciones/-messages.tsx";

// The conversation as the patient's phone shows it, by day, oldest first:
// the messages, and what has not gone yet where it was written, the reopen
// template before the replies that wait behind it.

type ChatItem =
  | { kind: "message"; at: number; message: InboxMessage }
  | { kind: "reopen"; at: number; reopen: QueuedReopen }
  | { kind: "lateReply"; at: number; reply: ShownLateReply };

export function ConversationChat(props: {
  messages: InboxMessage[];
  queuedReopen: QueuedReopen | null;
  lateReplies: ShownLateReply[];
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
  ];
  // A stable sort: the reopen template, queued with the first reply behind it, stays before it.
  items.sort((first, second) => first.at - second.at);
  return (
    <WhatsappChat label="Mensajes">
      {byDay(items, (item) => item.at, now).map((day, index) => (
        <Fragment key={`${index}-${day.label}`}>
          <WhatsappDay>{day.label}</WhatsappDay>
          {day.items.map((item) => (
            <ChatBubble key={`${item.kind}-${idOf(item)}`} item={item} />
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

function ChatBubble({ item }: { item: ChatItem }) {
  if (item.kind === "lateReply") {
    return <LateReplyBubble reply={item.reply} />;
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
  return <MessageBubble message={item.message} />;
}

function MessageBubble({ message }: { message: InboxMessage }) {
  const text = <span>{messageText(message)}</span>;
  const footer = (
    <>
      {messageClock(message.sentAt)}
      <MessageStatus message={message} />
    </>
  );
  const sender = messageSender(message);
  return sender === null ? (
    <PatientBubble footer={footer}>{text}</PatientBubble>
  ) : (
    <WhatsappBubble author={sender} footer={footer}>
      {text}
    </WhatsappBubble>
  );
}
