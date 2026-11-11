import { createFileRoute, Link } from "@tanstack/react-router";
import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { RefusalMessage, useFormAction } from "#/components/admin-form.tsx";
import { DataTable, RowLink, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { CreateButton } from "#/components/form-page.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { getWhatsappSettings, refreshWhatsappTemplates } from "#/server/whatsapp.functions.ts";

import {
  eventLabels,
  templateCategoryLabels,
  templateRefusalMessages,
  templateStatusLabels,
  templateStatusVariants,
  timingLabel,
  unsentLabel,
} from "#/lib/whatsapp-template-copy.ts";
import { isEventTemplate } from "#/lib/whatsapp-templates.ts";

export const Route = createFileRoute("/_app/whatsapp/plantillas/")({
  head: () => ({ meta: [{ title: "Plantillas de WhatsApp · underthing" }] }),
  loader: () => getWhatsappSettings(),
  component: Templates,
});

type Settings = Extract<Awaited<ReturnType<typeof getWhatsappSettings>>, { ok: true }>;

type ListedTemplate = Settings["templates"][number];

/** A template, with its latest version, if it was ever submitted. */
interface TemplateRow {
  id: string;
  name: string;
  /** When it goes, or for an event template its event. */
  when: string;
  latest: ListedTemplate["versions"][number] | undefined;
}

function rowOf(template: ListedTemplate): TemplateRow {
  const when = isEventTemplate(template.id)
    ? eventLabels[template.id]
    : template.timing
      ? timingLabel(template.timing)
      : "";
  return { id: template.id, name: template.name, when, latest: template.versions[0] };
}

const columns: DataTableColumn<TemplateRow>[] = [
  {
    id: "name",
    header: "Plantilla",
    cell: (row) => (
      <div className="flex flex-col">
        <RowLink to="/whatsapp/plantillas/$templateId" params={{ templateId: row.id }}>
          {row.name}
        </RowLink>
        <span className="text-muted-foreground text-sm">{row.when}</span>
      </div>
    ),
  },
  { id: "version", header: "Versión", cell: (row) => row.latest?.version ?? "—" },
  {
    id: "status",
    header: "Estado",
    cell: (row) =>
      row.latest ? (
        <div className="flex flex-wrap gap-1">
          <Badge variant={templateStatusVariants[row.latest.status]}>
            {templateStatusLabels[row.latest.status]}
          </Badge>
          {row.latest.category !== "utility" && (
            <Badge variant="warning">{templateCategoryLabels[row.latest.category]}</Badge>
          )}
        </div>
      ) : (
        <Badge variant="secondary">{unsentLabel}</Badge>
      ),
  },
];

function Templates() {
  const settings = Route.useLoaderData();
  if (!settings.ok) {
    return <RefusalMessage message={templateRefusalMessages[settings.reason]} />;
  }
  return <TemplateList settings={settings} />;
}

/** The organization's templates, its own and the event templates, and each one's latest verdict at Meta. */
function TemplateList({ settings }: { settings: Settings }) {
  const action = useFormAction(templateRefusalMessages);
  const [unread, setUnread] = useState<string | null>(null);
  const { table, pager } = useClientDataTable({
    rows: settings.templates.map(rowOf),
    columns,
    getRowId: (row) => row.id,
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Plantillas"
        description="Los mensajes con los que el consultorio les escribe primero a los pacientes."
        actions={
          <div className="flex gap-2">
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
            <CreateButton link={<Link to="/whatsapp/plantillas/nueva" />}>
              Nueva plantilla
            </CreateButton>
          </div>
        }
      />
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
      {/* The event templates are always there: never empty. */}
      <DataTable table={table} pager={pager} empty={null} />
    </div>
  );
}
