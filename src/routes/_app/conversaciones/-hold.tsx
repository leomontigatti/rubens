import { useState } from "react";
import type { FormEvent } from "react";

import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Field, FieldDescription, FieldLabel } from "#/components/ui/field.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { maxReplyLength } from "#/lib/conversation-holds.ts";
import type { ConversationHold, ConversationWindow } from "#/organization/inbox.ts";
import {
  replyToConversation,
  returnConversation,
  takeOverConversation,
} from "#/server/inbox.functions.ts";

import { messageTime } from "#/routes/_app/conversaciones/-labels.ts";
import { useInboxAction } from "#/routes/_app/conversaciones/-messages.tsx";

// Who answers the conversation: the assistant, or the member who took it
// over, as a badge beside the page's title, with taking it over or giving it
// back among the page's actions. Anyone who reads it takes it over at any
// time; its holder replies to the patient under their name, and gives it
// back. After the window closed the reply waits behind the reopen template
// until the patient answers.

const refusals = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo el personal puede responder conversaciones.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Escribí la respuesta.",
  notFound: "No encontramos esa conversación, o no es sobre tus turnos.",
  notHolding: "Otra persona tomó la conversación, o volvió al asistente. Recargá la página.",
  noReopenTemplate:
    "La ventana de conversación está cerrada y la plantilla Reabrir la conversación no está aprobada: un administrador la envía desde las plantillas de WhatsApp.",
  cannotReopen:
    "La ventana de conversación está cerrada y no podemos reabrirla: el número no es de ningún paciente que acepte WhatsApp.",
  notConnected: "El número de WhatsApp no está conectado.",
  numberHeld: "Meta limitó el número por ahora: probá más tarde.",
  sendFailed: "WhatsApp no aceptó el mensaje. Probá de nuevo.",
  tooLong: "Acortá la respuesta: con tu nombre supera el largo que acepta WhatsApp.",
};

/** Runs one of the hold's calls, then reloads the page; a refusal is a toast. */
export function useHoldAction() {
  return useInboxAction(refusals);
}

/** A text put in the reply's box from elsewhere on the page, such as a held reply; `id` tells two apart. */
export interface ReplyDraft {
  id: number;
  /** The conversation it belongs to: the page outlives a navigation to another one. */
  conversationId: string;
  text: string;
}

/** Who answers the conversation, as the badge beside its title. */
export function HoldBadge({ hold }: { hold: ConversationHold | null }) {
  return <Badge variant="secondary">{hold ? `Tomada por ${hold.holder}` : "Asistente"}</Badge>;
}

/** The page header's action on the hold: take the conversation over, or give it back once held. */
export function HoldActions(props: { conversationId: string; hold: ConversationHold | null }) {
  const action = useHoldAction();
  const data = { conversationId: props.conversationId };
  return props.hold?.mine ? (
    <Button
      variant="outline"
      disabled={action.running}
      onClick={() => void action.run("return-conversation", () => returnConversation({ data }))}
    >
      Devolver al asistente
    </Button>
  ) : (
    <Button
      variant="outline"
      disabled={action.running}
      onClick={() =>
        void action.run("take-over-conversation", () => takeOverConversation({ data }))
      }
    >
      Tomar conversación
    </Button>
  );
}

/** The reply's box, for the member who holds the conversation; nothing for anyone else. */
export function ReplyBox(props: {
  conversationId: string;
  hold: ConversationHold | null;
  window: ConversationWindow;
  draft: ReplyDraft | null;
}) {
  if (!props.hold?.mine) {
    return null;
  }
  return (
    <ReplyForm
      key={props.draft?.id}
      conversationId={props.conversationId}
      window={props.window}
      heldUntil={props.hold.heldUntil}
      initialText={props.draft?.text ?? ""}
    />
  );
}

function ReplyForm(props: {
  conversationId: string;
  window: ConversationWindow;
  heldUntil: number;
  initialText: string;
}) {
  const { running, run } = useHoldAction();
  const [text, setText] = useState(props.initialText);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const sent = await run("reply-to-conversation", () =>
      replyToConversation({ data: { conversationId: props.conversationId, text } }),
    );
    if (sent) {
      setText("");
    }
  }

  const { open, closesAt } = props.window;
  const sending =
    open && closesAt !== null
      ? `Le llega al paciente por WhatsApp con tu nombre. La ventana de conversación se cierra el ${messageTime(closesAt)}.`
      : "La ventana de conversación está cerrada: le enviamos al paciente una plantilla para reabrirla, y tu respuesta le llega con tu nombre cuando conteste.";
  const hint = `${sending} La conversación vuelve al asistente el ${messageTime(props.heldUntil)}.`;

  return (
    <form
      method="post"
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => void submit(event)}
    >
      <Field>
        <FieldLabel htmlFor="reply">Respuesta</FieldLabel>
        <Textarea
          id="reply"
          name="reply"
          value={text}
          maxLength={maxReplyLength}
          onChange={(event) => setText(event.target.value)}
          aria-describedby="reply-hint"
        />
        <FieldDescription id="reply-hint">{hint}</FieldDescription>
      </Field>
      <div>
        <Button type="submit" disabled={running || text.trim() === ""}>
          {running && <Spinner data-icon="inline-start" aria-hidden />}
          Enviar
        </Button>
      </div>
    </form>
  );
}
