import { ArrowRightLeftIcon } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { DataTable, NoMatches, RowLink, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { serverAnswer, shownPath } from "#/components/save-failure.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { toast } from "#/components/ui/toast.tsx";
import { handoffReasonLabels } from "#/lib/handoff-copy.ts";
import { formatPhone } from "#/lib/phones.ts";
import { closeHandoff } from "#/server/inbox.functions.ts";
import type { OpenHandoff } from "#/organization/handoff-inbox.ts";

import {
  conversationName,
  messageText,
  messageTime,
} from "#/routes/_app/conversaciones/-labels.ts";

// The open handoffs (ui: "Derivaciones") in the inbox: above the
// conversations, and on the conversation each belongs to, where whoever may
// answer it closes it without a reply. A clinical one shows that it exists,
// never words the member may not read: the object withholds them.

const closeRefusals = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden:
    "Solo un profesional que lleva historias clínicas puede cerrar una derivación clínica.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "No encontramos la derivación.",
  notFound: "La derivación ya está cerrada. Recargá la página.",
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

/** The conversation's open handoffs, each with `Cerrar sin responder` for whoever may answer it. */
export function ConversationHandoffs({ handoffs }: { handoffs: OpenHandoff[] }) {
  if (handoffs.length === 0) {
    return null;
  }
  return (
    <section aria-label="Derivaciones abiertas" className="flex flex-col gap-2">
      {handoffs.map((handoff) => (
        <HandoffNotice key={handoff.id} handoff={handoff} />
      ))}
    </section>
  );
}

/** Closes one handoff without a reply; a refusal is a toast, since no form holds it. */
function useCloseHandoff(handoffId: string) {
  const router = useRouter();
  const [closing, setClosing] = useState(false);

  async function close() {
    setClosing(true);
    try {
      const result = await serverAnswer("close-handoff", shownPath(router), () =>
        closeHandoff({ data: { handoffId } }),
      );
      if (result?.ok) {
        await router.invalidate();
      } else if (result) {
        toast.add({ title: closeRefusals[result.reason], type: "destructive" });
      }
    } finally {
      setClosing(false);
    }
  }

  return { closing, close };
}

function HandoffNotice({ handoff }: { handoff: OpenHandoff }) {
  const { closing, close } = useCloseHandoff(handoff.id);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm">
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
        <Button variant="outline" size="sm" disabled={closing} onClick={() => setConfirming(true)}>
          {closing && <Spinner data-icon="inline-start" aria-hidden />}
          Cerrar sin responder
        </Button>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="¿Cerrar la derivación sin responder?"
        description="Usalo cuando no queda nada que contestarle al paciente. El asistente vuelve a responder en esta conversación."
        confirmLabel="Cerrar derivación"
        onConfirm={() => void close()}
      />
    </div>
  );
}
