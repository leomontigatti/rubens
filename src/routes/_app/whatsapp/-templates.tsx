import { MessageSquareTextIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { useFormAction } from "#/components/admin-form.tsx";
import { DataTable, NoMatches, RowLink, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { RecordSection } from "#/components/record-section.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import type { TemplateName } from "#/lib/whatsapp-templates.ts";
import { refreshWhatsappTemplates } from "#/server/whatsapp.functions.ts";
import type { getWhatsappSettings } from "#/server/whatsapp.functions.ts";

import {
  rejectionText,
  templateLabels,
  templateRefusalMessages,
  templateStatusLabels,
  templateStatusVariants,
} from "#/routes/_app/whatsapp/-template-copy.ts";

type Settings = Extract<Awaited<ReturnType<typeof getWhatsappSettings>>, { ok: true }>;

/** A template of the set, with its latest version, if it was ever submitted. */
interface TemplateRow {
  name: TemplateName;
  latest: Settings["templates"][number]["versions"][number] | undefined;
}

const columns: DataTableColumn<TemplateRow>[] = [
  {
    id: "name",
    header: "Plantilla",
    cell: (row) => (
      <RowLink to="/whatsapp/plantillas/$templateName" params={{ templateName: row.name }}>
        {templateLabels[row.name]}
      </RowLink>
    ),
  },
  { id: "version", header: "Versión", cell: (row) => row.latest?.version ?? "—" },
  {
    id: "status",
    header: "Estado",
    cell: (row) =>
      row.latest ? (
        <Badge variant={templateStatusVariants[row.latest.status]}>
          {templateStatusLabels[row.latest.status]}
        </Badge>
      ) : (
        <Badge variant="secondary">Sin enviar</Badge>
      ),
  },
  {
    id: "reason",
    header: "Motivo del rechazo",
    cell: (row) => (row.latest?.rejectionReason ? rejectionText(row.latest.rejectionReason) : ""),
  },
];

/** The organization's templates and each one's latest verdict at Meta. */
export function TemplateList({ settings }: { settings: Settings }) {
  const action = useFormAction(templateRefusalMessages);
  const [unread, setUnread] = useState<string | null>(null);
  const { table, query, setQuery } = useClientDataTable({
    rows: settings.templates.map(({ name, versions }) => ({ name, latest: versions[0] })),
    columns,
    getRowId: (row) => row.name,
    searchText: (row) => `${templateLabels[row.name]} ${row.name}`,
  });

  async function refresh() {
    setUnread(null);
    await action.run(async () => {
      const result = await refreshWhatsappTemplates();
      if (result.ok && result.failures.length > 0) {
        setUnread(result.failures[0]!.message);
      }
      return result.ok ? { ok: true } : result;
    });
  }

  const missing = settings.templateMissing && templateRefusalMessages[settings.templateMissing];
  return (
    <RecordSection
      title="Plantillas"
      action={
        <Button
          variant="outline"
          disabled={Boolean(missing) || action.pending}
          onClick={() => void refresh()}
        >
          {action.pending ? (
            <Spinner data-icon="inline-start" aria-hidden />
          ) : (
            <RefreshCwIcon data-icon="inline-start" aria-hidden />
          )}
          Actualizar estados
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {missing && (
          <Alert variant="warning">
            <AlertTitle>No se pueden enviar plantillas a Meta</AlertTitle>
            <AlertDescription>{missing}</AlertDescription>
          </Alert>
        )}
        {action.error && (
          <Alert variant="destructive">
            <AlertTitle>No se pudieron actualizar los estados</AlertTitle>
            <AlertDescription>{action.error}</AlertDescription>
          </Alert>
        )}
        {unread && (
          <Alert variant="warning">
            <AlertTitle>Meta no devolvió el estado de alguna plantilla</AlertTitle>
            <AlertDescription>{unread}</AlertDescription>
          </Alert>
        )}
        <DataTable
          table={table}
          search={{
            value: query,
            onChange: setQuery,
            label: "Buscar plantilla",
            placeholder: "Buscar por nombre",
          }}
          empty={<NoMatches icon={MessageSquareTextIcon} />}
        />
      </div>
    </RecordSection>
  );
}
