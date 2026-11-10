import { ArrowRightLeftIcon } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { DataTable, NoMatches, RowLink, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { handoffReasonLabels } from "#/lib/handoff-copy.ts";
import type { OptOutReport } from "#/lib/handoffs.ts";
import { formatPhone } from "#/lib/phones.ts";
import { closeHandoff, dropHeldReply, reportOptOut } from "#/server/inbox.functions.ts";
import type { OpenHandoff } from "#/organization/handoff-inbox.ts";

import {
  conversationName,
  messageText,
  messageTime,
} from "#/routes/_app/conversaciones/-labels.ts";
import { useInboxAction } from "#/routes/_app/conversaciones/-messages.tsx";

// The open handoffs (ui: "Derivaciones") in the inbox: above the
// conversations, and on the conversation each belongs to, where whoever may
// answer it closes it without a reply. A clinical one shows that it exists,
// never words the member may not read: the object withholds them. A reply the
// clinical check held reaches only the handoff's recipients, who send it, fix
// it in the reply's box or drop it. On a clinical one, whoever reads its words
// reports an opt-out among them to reception, which cannot read them.

const closeRefusals = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden:
    "Solo un profesional que lleva historias clínicas puede cerrar una derivación clínica.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "No encontramos la derivación.",
  notFound: "La derivación ya está cerrada. Recargá la página.",
};

const optOutRefusals = {
  ...closeRefusals,
  forbidden: "Solo un profesional que lleva historias clínicas puede leer estos mensajes.",
  nobodyToTurnOff: "Ningún paciente de este número recibe mensajes por WhatsApp.",
};

function recipientsText(recipients: string[]) {
  return recipients.length > 0 ? recipients.join(", ") : "Sin destinatarios";
}

function Reason({ handoff }: { handoff: OpenHandoff }) {
  return (
    <span className="flex items-center gap-2">
      {handoffReasonLabels[handoff.reason]}
      {handoff.clinical && <Badge variant="info">Clínica</Badge>}
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
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex flex-col gap-4 rounded-xl border p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground">
            Derivación abierta: el asistente no responde hasta que se cierre.
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
        {handoff.mayClose && (
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
      {handoff.optOut !== null && handoff.lastPatientMessage && (
        <ClinicalOptOut
          report={{ handoffId: handoff.id, throughMessageId: handoff.lastPatientMessage.id }}
          reported={handoff.optOut === "reported"}
        />
      )}
      {handoff.heldReply !== null && (
        <HeldReply
          handoffId={handoff.id}
          text={handoff.heldReply}
          onUse={() => props.onUseReply(handoff.heldReply ?? "")}
        />
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="¿Cerrar la derivación sin responder?"
        description="Usalo cuando no queda nada que contestarle al paciente. El asistente vuelve a responder en esta conversación."
        confirmLabel="Cerrar derivación"
        onConfirm={() => void close.run("close-handoff", () => closeHandoff({ data }))}
      />
    </div>
  );
}

/**
 * The prompt on a clinical handoff: its reader looks for an opt-out among
 * words reception cannot read, and reports it to reception, which decides.
 */
function ClinicalOptOut(props: { report: OptOutReport; reported: boolean }) {
  const report = useInboxAction(optOutRefusals);
  const [confirming, setConfirming] = useState(false);
  if (props.reported) {
    return (
      <p className="bg-muted/50 text-muted-foreground rounded-lg p-3">
        Se avisó a recepción que este número pidió no recibir mensajes por WhatsApp.
      </p>
    );
  }
  return (
    <div className="bg-muted/50 flex flex-wrap items-center justify-between gap-3 rounded-lg p-3">
      <p className="text-muted-foreground">
        Recepción no ve estos mensajes. Si el paciente pide no recibir más mensajes por WhatsApp,
        avisale desde acá.
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={report.running}
        onClick={() => setConfirming(true)}
      >
        {report.running && <Spinner data-icon="inline-start" aria-hidden />}
        Pidió no recibir mensajes
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="¿Avisar a recepción que pidió no recibir mensajes?"
        description="Recepción decide si desactiva WhatsApp para los pacientes de este número. Hasta entonces no les enviamos recordatorios ni avisos. La derivación sigue abierta."
        confirmLabel="Avisar a recepción"
        onConfirm={() =>
          void report.run("report-opt-out", () => reportOptOut({ data: props.report }))
        }
      />
    </div>
  );
}

/** The reply the clinical check held, which its recipient sends or fixes in the reply's box, or drops. */
function HeldReply(props: { handoffId: string; text: string; onUse: () => void }) {
  const drop = useInboxAction(closeRefusals);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="bg-muted/50 flex flex-col gap-3 rounded-lg p-3">
      <div className="flex flex-col gap-1">
        <p className="font-medium">Respuesta retenida del asistente</p>
        <p className="text-muted-foreground">
          No se envió porque habla de algo clínico o de otro paciente. Solo la ve quien recibió la
          derivación.
        </p>
      </div>
      <p className="whitespace-pre-wrap">{props.text}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={props.onUse}>
          Usar esta respuesta
        </Button>
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
