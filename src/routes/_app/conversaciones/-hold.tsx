import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import { serverAnswer, shownPath } from "#/components/save-failure.ts";
import { Button } from "#/components/ui/button.tsx";
import { Field, FieldDescription, FieldLabel } from "#/components/ui/field.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { toast } from "#/components/ui/toast.tsx";
import { maxReplyLength } from "#/lib/conversation-holds.ts";
import type { ConversationHold, ConversationWindow } from "#/organization/inbox.ts";
import {
  replyToConversation,
  returnConversation,
  takeOverConversation,
} from "#/server/inbox.functions.ts";

import { messageTime } from "#/routes/_app/conversaciones/-labels.ts";

// Who answers the conversation: the assistant, or the member who took it
// over. Anyone who reads it takes it over at any time; its holder replies to
// the patient under their name, inside the window, and gives it back.

const refusals = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo el personal puede responder conversaciones.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Escribí la respuesta.",
  notFound: "No encontramos esa conversación, o no es sobre tus turnos.",
  notHolding: "Otra persona tomó la conversación, o volvió al asistente. Recargá la página.",
  windowClosed:
    "La ventana de conversación se cerró: el paciente tiene que escribir de nuevo para que le lleguen respuestas.",
  notConnected: "El número de WhatsApp no está conectado.",
  numberHeld: "Meta limitó el número por ahora: probá más tarde.",
  sendFailed: "WhatsApp no aceptó el mensaje. Probá de nuevo.",
  tooLong: "Acortá la respuesta: con tu nombre supera el largo que acepta WhatsApp.",
};

type Refusal = keyof typeof refusals;

/** Runs one of the hold's calls, then reloads the page; a refusal is a toast. */
function useHoldAction() {
  const router = useRouter();
  const [running, setRunning] = useState(false);

  async function run(
    tag: string,
    call: () => Promise<{ ok: true } | { ok: false; reason: Refusal }>,
  ) {
    setRunning(true);
    try {
      const result = await serverAnswer(tag, shownPath(router), call);
      if (result?.ok) {
        await router.invalidate();
      } else if (result) {
        toast.add({ title: refusals[result.reason], type: "destructive" });
      }
      return result?.ok === true;
    } finally {
      setRunning(false);
    }
  }

  return { running, run };
}

export function ConversationHolder(props: {
  conversationId: string;
  hold: ConversationHold | null;
  window: ConversationWindow;
}) {
  const { conversationId, hold } = props;
  const action = useHoldAction();
  const data = { conversationId };

  const status = hold
    ? `${hold.mine ? "La estás respondiendo vos" : `La está respondiendo ${hold.holder}`}. Vuelve al asistente el ${messageTime(hold.heldUntil)}.`
    : "La responde el asistente.";

  return (
    <section aria-label="Quién responde" className="flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p>{status}</p>
        {hold?.mine ? (
          <Button
            variant="outline"
            size="sm"
            disabled={action.running}
            onClick={() =>
              void action.run("return-conversation", () => returnConversation({ data }))
            }
          >
            Devolver al asistente
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={action.running}
            onClick={() =>
              void action.run("take-over-conversation", () => takeOverConversation({ data }))
            }
          >
            Tomar conversación
          </Button>
        )}
      </div>
      {hold?.mine && <ReplyForm conversationId={conversationId} window={props.window} />}
    </section>
  );
}

function ReplyForm(props: { conversationId: string; window: ConversationWindow }) {
  const { running, run } = useHoldAction();
  const [text, setText] = useState("");

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
  const hint =
    open && closesAt !== null
      ? `Le llega al paciente por WhatsApp con tu nombre. La ventana de conversación se cierra el ${messageTime(closesAt)}.`
      : "La ventana de conversación está cerrada: el paciente tiene que escribir de nuevo para que le lleguen respuestas.";

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
          disabled={!open}
          onChange={(event) => setText(event.target.value)}
          aria-describedby="reply-hint"
        />
        <FieldDescription id="reply-hint">{hint}</FieldDescription>
      </Field>
      <div>
        <Button type="submit" disabled={running || !open || text.trim() === ""}>
          {running && <Spinner data-icon="inline-start" aria-hidden />}
          Enviar
        </Button>
      </div>
    </form>
  );
}
