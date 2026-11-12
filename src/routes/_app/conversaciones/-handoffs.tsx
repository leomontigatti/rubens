import { ArrowRightLeftIcon } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { DataTable, NoMatches, RowLink, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { handoffReasonLabel } from "#/lib/handoff-copy.ts";
import { formatPhone } from "#/lib/phones.ts";
import { closeHandoff, dropHeldReply, passToPractitioner } from "#/server/inbox.functions.ts";
import type { OpenHandoff } from "#/organization/handoff-inbox.ts";

import {
  conversationName,
  messageText,
  messageTime,
} from "#/routes/_app/conversaciones/-labels.ts";
import { useInboxAction } from "#/routes/_app/conversaciones/-messages.tsx";

// The open handoffs (ui: "Derivaciones") in the inbox: above the
// conversations, and on the conversation each belongs to, where whoever may
// answer it closes it without a reply, and whoever reads one to reception
// passes it to the practitioner. A reply the clinical check held shows to
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

function recipientsText(recipients: string[]) {
  return recipients.length > 0 ? recipients.join(", ") : "Sin destinatarios";
}

function Reason({ handoff }: { handoff: OpenHandoff }) {
  return (
    <span className="flex items-center gap-2">
      {handoffReasonLabel(handoff.reason, handoff.media)}
      {handoff.forPractitioner && <Badge variant="info">Para el profesional</Badge>}
    </span>
  );
}

type HandoffRow = OpenHandoff & { name: string };

const columns: DataTableColumn<HandoffRow>[] = [
  {
    id: "name",
    header: "Contacto",
    cell: (handoff) => (
      <RowLink
        to="/conversaciones/$conversationId"
        params={{ conversationId: handoff.conversationId }}
      >
        {handoff.name}
      </RowLink>
    ),
  },
  { id: "reason", header: "Motivo", cell: (handoff) => <Reason handoff={handoff} /> },
  { id: "to", header: "Derivada a", cell: (handoff) => recipientsText(handoff.recipients) },
  {
    id: "last",
    header: "Último mensaje",
    cell: ({ lastPatientMessage }) => (
      <span className="text-muted-foreground block max-w-sm truncate">
        {lastPatientMessage ? messageText(lastPatientMessage) : ""}
      </span>
    ),
  },
  { id: "at", header: "Fecha", cell: (handoff) => messageTime(handoff.createdAt) },
];

/** Every open handoff the member sees, newest first; nothing when there is none. */
export function OpenHandoffList({ handoffs }: { handoffs: OpenHandoff[] }) {
  const { table, pager, query, setQuery } = useClientDataTable({
    rows: handoffs.map((handoff) => ({ ...handoff, name: conversationName(handoff) })),
    columns,
    getRowId: (handoff) => handoff.id,
    searchText: (handoff) => `${handoff.name} ${formatPhone(handoff.phone)} ${handoff.phone}`,
  });
  if (handoffs.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="open-handoffs" className="flex flex-col gap-3">
      <h2 id="open-handoffs" className="text-base font-semibold">
        Derivaciones abiertas
      </h2>
      <DataTable
        table={table}
        pager={pager}
        search={{
          value: query,
          onChange: setQuery,
          label: "Buscar derivación",
          placeholder: "Buscar por paciente o teléfono",
        }}
        empty={<NoMatches icon={ArrowRightLeftIcon} />}
      />
    </section>
  );
}

/**
 * The conversation's open handoffs, each with `Cerrar sin responder` for
 * whoever may answer it, and a held reply for its recipients.
 */
export function ConversationHandoffs(props: {
  handoffs: OpenHandoff[];
  /** Puts a held reply in the reply's box. */
  onUseReply: (text: string) => void;
}) {
  if (props.handoffs.length === 0) {
    return null;
  }
  return (
    <section aria-label="Derivaciones abiertas" className="flex flex-col gap-2">
      {props.handoffs.map((handoff) => (
        <HandoffNotice key={handoff.id} handoff={handoff} onUseReply={props.onUseReply} />
      ))}
    </section>
  );
}

function HandoffNotice(props: { handoff: OpenHandoff; onUseReply: (text: string) => void }) {
  const { handoff } = props;
  const data = { handoffId: handoff.id };
  const close = useInboxAction(closeRefusals);
  const pass = useInboxAction(passRefusals);
  const [confirming, setConfirming] = useState(false);
  const [passing, setPassing] = useState(false);
  return (
    <div className="flex flex-col gap-4 rounded-xl border p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground">
            Derivación abierta: una persona responde lo derivado, y el asistente sigue con lo demás.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              <Reason handoff={handoff} />
            </span>
            <span className="text-muted-foreground">
              Derivada a {recipientsText(handoff.recipients)} · {messageTime(handoff.createdAt)}
            </span>
          </div>
        </div>
        {(handoff.mayPass || handoff.mayAnswer) && (
          <div className="flex flex-wrap gap-2">
            {handoff.mayPass && (
              <Button
                variant="outline"
                size="sm"
                disabled={pass.running}
                onClick={() => setPassing(true)}
              >
                {pass.running && <Spinner data-icon="inline-start" aria-hidden />}
                Pasar al profesional
              </Button>
            )}
            {handoff.mayAnswer && (
              <Button
                variant="outline"
                size="sm"
                disabled={close.running}
                onClick={() => setConfirming(true)}
              >
                {close.running && <Spinner data-icon="inline-start" aria-hidden />}
                Cerrar sin responder
              </Button>
            )}
          </div>
        )}
      </div>
      {handoff.heldReply !== null && (
        <HeldReply
          handoffId={handoff.id}
          text={handoff.heldReply}
          onUse={handoff.mayUseHeldReply ? () => props.onUseReply(handoff.heldReply ?? "") : null}
        />
      )}
      <ConfirmDialog
        open={passing}
        onOpenChange={setPassing}
        title="¿Pasar la derivación al profesional?"
        description="Le llega al profesional del turno, o a los contactos de derivación que llevan historias clínicas, y la responde él. Al paciente no le enviamos nada."
        confirmLabel="Pasar al profesional"
        destructive={false}
        onConfirm={() => void pass.run("pass-to-practitioner", () => passToPractitioner({ data }))}
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="¿Cerrar la derivación sin responder?"
        description="Usalo cuando no queda nada que contestarle al paciente. La derivación deja de figurar como abierta."
        confirmLabel="Cerrar derivación"
        onConfirm={() => void close.run("close-handoff", () => closeHandoff({ data }))}
      />
    </div>
  );
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
    <div className="bg-muted/50 flex flex-col gap-3 rounded-lg p-3">
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
    </div>
  );
}
