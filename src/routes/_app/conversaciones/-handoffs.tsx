import { useState } from "react";

import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { handoffReasonLabel } from "#/lib/handoff-copy.ts";
import { closeHandoff, dropHeldReply, passToPractitioner } from "#/server/inbox.functions.ts";
import type { OpenHandoff } from "#/organization/handoff-inbox.ts";
import type { ListedHandoff } from "#/organization/inbox.ts";

import { useInboxAction } from "#/routes/_app/conversaciones/-messages.tsx";

// The open handoffs (ui: "Derivaciones") in the inbox: in the list's
// `Derivación` column, and in the header of the conversation each belongs
// to, where whoever may answer it closes it without a reply, and whoever
// reads one to reception passes it to the practitioner. One to the
// practitioner is marked `Clínica`. A reply the clinical check held shows to
// every reader: a practitioner who keeps clinical records sends it or fixes
// it in the reply's box, and anyone drops it.

const closeRefusals = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden:
    "Solo un profesional que lleva historias clínicas puede cerrar una derivación al profesional.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "No encontramos la derivación.",
  notFound: "La derivación ya está cerrada. Recargá la página.",
};

const passRefusals = {
  ...closeRefusals,
  withPractitioner: "Ya hay una derivación al profesional abierta en esta conversación.",
};

const names = new Intl.ListFormat("es", { type: "conjunction" });

/** Who the handoff went to: `Derivada a Rita Paz y Juan Gómez`. */
function sentTo(handoff: Pick<ListedHandoff, "recipients">) {
  return handoff.recipients.length > 0
    ? `Derivada a ${names.format(handoff.recipients)}`
    : "Derivada sin destinatarios";
}

function reasonOf(handoff: Pick<ListedHandoff, "reason" | "media">) {
  return handoffReasonLabel(handoff.reason, handoff.media);
}

function ClinicalBadge() {
  return <Badge variant="info">Clínica</Badge>;
}

/** A conversation's open handoffs in the list's `Derivación` column: why, to whom, and whether clinical. */
export function HandoffSummary({ handoffs }: { handoffs: ListedHandoff[] }) {
  return (
    <div className="flex flex-col gap-1">
      {handoffs.map((handoff) => (
        <div key={handoff.id} className="flex flex-col">
          <span className="flex items-center gap-2">
            {reasonOf(handoff)}
            {handoff.forPractitioner && <ClinicalBadge />}
          </span>
          <span className="text-muted-foreground">{sentTo(handoff)}</span>
        </div>
      ))}
    </div>
  );
}

/** The header's badge for each open handoff, beside who answers the conversation. */
export function HandoffBadges({ handoffs }: { handoffs: OpenHandoff[] }) {
  return handoffs.map((handoff) => (
    <Badge key={handoff.id} variant={handoff.forPractitioner ? "info" : "outline"}>
      {sentTo(handoff)}
      {handoff.forPractitioner && " · Clínica"}
    </Badge>
  ));
}

/** The header's description: the number, then why each handoff was made and what the assistant leaves to it. */
export function HandoffDescription(props: { phone: string; handoffs: OpenHandoff[] }) {
  return (
    <div className="text-muted-foreground flex flex-col gap-0.5 text-sm">
      <p>{props.phone}</p>
      {props.handoffs.map((handoff) => (
        <p key={handoff.id}>
          {reasonOf(handoff)} · el asistente no responde sobre esto hasta que se cierre
        </p>
      ))}
    </div>
  );
}

/** The header's actions on the open handoffs: `Pasar al profesional`, and `Cerrar sin responder` for whoever may answer. */
export function HandoffActions({ handoffs }: { handoffs: OpenHandoff[] }) {
  const closable = handoffs.filter((handoff) => handoff.mayAnswer);
  return (
    <>
      {handoffs
        .filter((handoff) => handoff.mayPass)
        .map((handoff) => (
          <PassButton key={handoff.id} handoffId={handoff.id} />
        ))}
      {closable.map((handoff) => (
        <CloseButton
          key={handoff.id}
          handoff={handoff}
          // Two to close: the button says which.
          label={
            closable.length > 1 && handoff.forPractitioner
              ? "Cerrar sin responder · Clínica"
              : "Cerrar sin responder"
          }
        />
      ))}
    </>
  );
}

function PassButton({ handoffId }: { handoffId: string }) {
  const pass = useInboxAction(passRefusals);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button variant="outline" disabled={pass.running} onClick={() => setConfirming(true)}>
        {pass.running && <Spinner data-icon="inline-start" aria-hidden />}
        Pasar al profesional
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="¿Pasar la derivación al profesional?"
        description="Le llega al profesional del turno, o a los contactos de derivación que llevan historias clínicas, y la responde él. Al paciente no le enviamos nada."
        confirmLabel="Pasar al profesional"
        destructive={false}
        onConfirm={() =>
          void pass.run("pass-to-practitioner", () => passToPractitioner({ data: { handoffId } }))
        }
      />
    </>
  );
}

function CloseButton(props: { handoff: OpenHandoff; label: string }) {
  const close = useInboxAction(closeRefusals);
  const [confirming, setConfirming] = useState(false);
  const data = { handoffId: props.handoff.id };
  return (
    <>
      <Button variant="outline" disabled={close.running} onClick={() => setConfirming(true)}>
        {close.running && <Spinner data-icon="inline-start" aria-hidden />}
        {props.label}
      </Button>
      {/* Closing loses nothing: a reply can still follow, so it is not a destructive action. */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="¿Cerrar la derivación sin responder?"
        description={`Usalo cuando no queda nada que contestarle al paciente. La derivación «${reasonOf(props.handoff)}» deja de figurar como abierta.`}
        confirmLabel="Cerrar derivación"
        destructive={false}
        onConfirm={() => void close.run("close-handoff", () => closeHandoff({ data }))}
      />
    </>
  );
}

/** The replies the clinical check held on the conversation's open handoffs. */
export function HeldReplies(props: {
  handoffs: OpenHandoff[];
  /** Puts a held reply in the reply's box. */
  onUseReply: (text: string) => void;
}) {
  return props.handoffs.flatMap((handoff) => {
    const text = handoff.heldReply;
    return text === null
      ? []
      : [
          <HeldReply
            key={handoff.id}
            handoffId={handoff.id}
            text={text}
            onUse={handoff.mayUseHeldReply ? () => props.onUseReply(text) : null}
          />,
        ];
  });
}

/**
 * The reply the clinical check held, which a practitioner who keeps clinical
 * records sends or fixes in the reply's box (`onUse`, `null` for anyone
 * else), and anyone who reads it drops.
 */
function HeldReply(props: { handoffId: string; text: string; onUse: (() => void) | null }) {
  const drop = useInboxAction(closeRefusals);
  const [confirming, setConfirming] = useState(false);
  return (
    <section
      aria-label="Respuesta retenida del asistente"
      className="bg-muted/50 flex flex-col gap-3 rounded-lg p-3 text-sm"
    >
      <div className="flex flex-col gap-1">
        <p className="font-medium">Respuesta retenida del asistente</p>
        <p className="text-muted-foreground">
          No se envió porque habla de algo clínico o de otro paciente. Solo un profesional puede
          enviarla o corregirla.
        </p>
      </div>
      <p className="whitespace-pre-wrap">{props.text}</p>
      <div className="flex flex-wrap gap-2">
        {props.onUse && (
          <Button variant="outline" size="sm" onClick={props.onUse}>
            Usar esta respuesta
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={drop.running}
          onClick={() => setConfirming(true)}
        >
          {drop.running && <Spinner data-icon="inline-start" aria-hidden />}
          Descartar
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="¿Descartar la respuesta retenida?"
        description="No le llega al paciente. La derivación sigue abierta hasta que le respondas o la cierres."
        confirmLabel="Descartar respuesta"
        onConfirm={() =>
          void drop.run("drop-held-reply", () =>
            dropHeldReply({ data: { handoffId: props.handoffId } }),
          )
        }
      />
    </section>
  );
}
