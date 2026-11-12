import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";

import { RefusalMessage, useFormAction } from "#/components/admin-form.tsx";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { deleteTemplate, editTemplate, getWhatsappSettings } from "#/server/whatsapp.functions.ts";

import {
  rejectionText,
  templateCategoryLabels,
  templateRefusalMessages,
  templateStatusLabels,
  templateStatusVariants,
  unsentLabel,
} from "#/lib/whatsapp-template-copy.ts";

import { TemplateForm } from "#/routes/_app/whatsapp/plantillas/-template-form.tsx";
import { TemplateVersions } from "#/routes/_app/whatsapp/plantillas/-template-preview.tsx";
import type { TemplateVersion } from "#/routes/_app/whatsapp/plantillas/-template-preview.tsx";

export const Route = createFileRoute("/_app/whatsapp/plantillas/$templateId")({
  head: () => ({ meta: [{ title: "Editar plantilla · underthing" }] }),
  loader: () => getWhatsappSettings(),
  component: EditTemplate,
});

type Settings = Extract<Awaited<ReturnType<typeof getWhatsappSettings>>, { ok: true }>;

type ListedTemplate = Settings["templates"][number];

const notFound = "No encontramos esa plantilla.";

const deleteRefusals = {
  ...templateRefusalMessages,
  notFound,
  submitted: "Ya se envió a Meta: no se puede eliminar.",
  picked: "Una prestación la envía: quitala de sus mensajes antes de eliminarla.",
};

function EditTemplate() {
  const listed = Route.useLoaderData();
  const { templateId } = Route.useParams();
  if (!listed.ok) {
    return <RefusalMessage message={templateRefusalMessages[listed.reason]} />;
  }
  const template = listed.templates.find((one) => one.id === templateId);
  if (!template) {
    return <RefusalMessage message={notFound} />;
  }
  return (
    <div className="flex flex-col gap-6">
      {/* Keyed: another template's page starts its form afresh, not from this one's state. */}
      <EditForm key={template.id} template={template} organizationName={listed.organizationName} />
      <TemplateVersions versions={template.versions} organizationName={listed.organizationName} />
    </div>
  );
}

/** What Meta last said of the latest version, when it keeps the template from going. */
function LatestWarning({ latest }: { latest: TemplateVersion | undefined }) {
  if (latest && latest.category !== "utility") {
    return (
      <Alert variant="warning">
        <AlertTitle>
          Meta pasó la última versión a {templateCategoryLabels[latest.category]}
        </AlertTitle>
        <AlertDescription>
          Cuesta más del doble que una de utilidad, así que underthing deja de enviarla. Enviá una
          versión nueva, sobre el turno del paciente y sin nada promocional.
        </AlertDescription>
      </Alert>
    );
  }
  if (latest?.status === "rejected") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Meta rechazó la última versión</AlertTitle>
        <AlertDescription>
          {latest.rejectionReason
            ? rejectionText(latest.rejectionReason)
            : "Meta no dio el motivo."}{" "}
          Corregí el texto y enviá una versión nueva.
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

/** Deletes a template never sent and picked by no medical service, once confirmed. */
function DeleteButton(props: { templateId: string; busy: boolean }) {
  const router = useRouter();
  const action = useFormAction(deleteRefusals);
  const [open, setOpen] = useState(false);

  async function remove() {
    const removed = await action.run(() =>
      deleteTemplate({ data: { templateId: props.templateId } }),
    );
    if (removed) {
      await router.navigate({ to: "/whatsapp/plantillas" });
    }
  }

  return (
    <>
      <Button
        variant="outline"
        disabled={props.busy || action.pending}
        onClick={() => setOpen(true)}
      >
        <Trash2Icon data-icon="inline-start" aria-hidden />
        Eliminar
      </Button>
      {action.error && <p className="text-destructive text-sm">{action.error}</p>}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="¿Eliminar la plantilla?"
        description="Todavía no se envió a Meta y ninguna prestación la envía."
        confirmLabel="Eliminar"
        onConfirm={() => void remove()}
      />
    </>
  );
}

function EditForm(props: { template: ListedTemplate; organizationName: string }) {
  const { template } = props;
  const latest = template.versions[0];
  const deletable = !template.event && !latest && !template.picked;
  const settings =
    template.timing && !template.event ? { name: template.name, timing: template.timing } : null;

  const versionNote = latest
    ? "Si cambiás el texto, se envía a Meta como una versión nueva, que Meta revisa de nuevo."
    : "Todavía no se envió a Meta. Al guardarla, se envía y Meta la revisa antes de que se pueda usar.";

  return (
    <TemplateForm
      templateId={template.id}
      settings={settings}
      body={latest?.body ?? template.draft ?? ""}
      sentBody={latest?.body ?? null}
      organizationName={props.organizationName}
      title="Editar plantilla"
      description={template.name}
      submitLabel={(bodyChanged) => (bodyChanged ? "Guardar y enviar a Meta" : "Guardar")}
      versionNote={versionNote}
      followsTrato={template.followsTrato}
      record={{
        status: latest ? (
          <Badge variant={templateStatusVariants[latest.status]}>
            {templateStatusLabels[latest.status]}
          </Badge>
        ) : (
          <Badge variant="secondary">{unsentLabel}</Badge>
        ),
        actions: (busy) =>
          deletable ? <DeleteButton templateId={template.id} busy={busy} /> : null,
        error: null,
      }}
      lead={<LatestWarning latest={latest} />}
      save={(values) => editTemplate({ data: { templateId: template.id, ...values } })}
    />
  );
}
