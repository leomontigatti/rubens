import { cn } from "cn";
import { useState } from "react";

import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { WhatsappBubble } from "#/components/whatsapp-bubble.tsx";
import type { ShownLateReply } from "#/organization/late-replies.ts";
import { withdrawLateReply } from "#/server/inbox.functions.ts";

import { messageTime } from "#/routes/_app/conversaciones/-labels.ts";
import { useInboxAction } from "#/routes/_app/conversaciones/-messages.tsx";

// A reply written after the window closed (ui: "Respuesta en espera"),
// after the conversation's messages: waiting for the patient to answer the
// reopen template, which its writer may withdraw until they do, or not
// delivered because they never did.

const lateReplyLabels = {
  waiting: {
    badge: "En espera",
    hint: "Le enviamos al paciente la plantilla para reabrir la conversación. Le llega cuando responda.",
  },
  notDelivered: {
    badge: "No entregada",
    hint: "No le llegó: el paciente no respondió a tiempo la plantilla para reabrir la conversación, o no se le pudo enviar.",
  },
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

/** The reply as the patient will read it, on the clinic's side, with what it waits for under it. */
export function LateReplyBubble({ reply }: { reply: ShownLateReply }) {
  const labels = lateReplyLabels[reply.state];
  return (
    <div className="flex max-w-md flex-col items-end gap-1 self-end">
      <WhatsappBubble
        author={reply.writer}
        footer={
          <>
            {messageTime(reply.writtenAt)}
            <Badge variant={reply.state === "notDelivered" ? "destructive" : "secondary"}>
              {labels.badge}
            </Badge>
          </>
        }
      >
        <span className={cn(reply.text === null && "text-muted-foreground italic")}>
          {reply.text ?? "Hay una respuesta clínica. Solo la leen los profesionales."}
        </span>
      </WhatsappBubble>
      <p className="text-muted-foreground text-right text-xs">{labels.hint}</p>
      {reply.mine && reply.state === "waiting" && <WithdrawButton lateReplyId={reply.id} />}
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
