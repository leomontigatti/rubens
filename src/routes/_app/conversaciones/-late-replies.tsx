import { cn } from "cn";
import { useState } from "react";

import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { WhatsappBubble } from "#/components/whatsapp-bubble.tsx";
import { WhatsappStatus } from "#/components/whatsapp-status.tsx";
import type { ShownLateReply } from "#/organization/late-replies.ts";
import { withdrawLateReply } from "#/server/inbox.functions.ts";

import { messageClock } from "#/routes/_app/conversaciones/-labels.ts";
import { useInboxAction } from "#/routes/_app/conversaciones/-messages.tsx";

// A reply written after the window closed (ui: "Respuesta en espera"), in
// the chat where it was written: waiting for the patient to answer the
// reopen template, which its writer may withdraw until they do, or not
// delivered because they never did.

const lateReplyHints = {
  waiting: "Se envía cuando el paciente responda.",
  notDelivered:
    "No le llegó: el paciente no respondió a tiempo la plantilla para reabrir la conversación, o no se le pudo enviar.",
} as const;

const withdrawRefusals = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo el personal puede retirar respuestas.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "No encontramos esa respuesta.",
  notFound: "No encontramos esa respuesta, o no la escribiste vos.",
  notWaiting: "La respuesta ya no está en espera. Recargá la página.",
  answered: "El paciente ya respondió: la respuesta le llega ahora y no se puede retirar.",
};

/**
 * The reply as the patient will read it, on the clinic's side: muted with a
 * clock while it waits, as WhatsApp shows a message not sent yet, with what
 * it waits for under it.
 */
export function LateReplyBubble({ reply }: { reply: ShownLateReply }) {
  const waiting = reply.state === "waiting";
  return (
    <div className="flex max-w-md flex-col items-end gap-1 self-end">
      <WhatsappBubble
        author={reply.writer}
        pending={waiting}
        footer={
          <>
            {messageClock(reply.writtenAt)}
            <WhatsappStatus status={waiting ? "waiting" : "failed"} />
          </>
        }
      >
        <span className={cn(reply.text === null && "text-muted-foreground italic")}>
          {reply.text ?? "Hay una respuesta clínica. Solo la leen los profesionales."}
        </span>
      </WhatsappBubble>
      <p className="text-muted-foreground text-right text-xs">{lateReplyHints[reply.state]}</p>
      {reply.mine && waiting && <WithdrawButton lateReplyId={reply.id} />}
    </div>
  );
}

/** Withdraws the member's own waiting reply, once they confirm: it never reaches the patient. */
function WithdrawButton({ lateReplyId }: { lateReplyId: string }) {
  const withdraw = useInboxAction(withdrawRefusals);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={withdraw.running}
        onClick={() => setConfirming(true)}
      >
        {withdraw.running && <Spinner data-icon="inline-start" aria-hidden />}
        Retirar
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="¿Retirar la respuesta en espera?"
        description="No le llega al paciente aunque responda la plantilla. Si no queda otra respuesta en espera y la plantilla todavía no salió, tampoco se la enviamos."
        confirmLabel="Retirar respuesta"
        onConfirm={() =>
          void withdraw.run("withdraw-late-reply", () =>
            withdrawLateReply({ data: { lateReplyId } }),
          )
        }
      />
    </>
  );
}
