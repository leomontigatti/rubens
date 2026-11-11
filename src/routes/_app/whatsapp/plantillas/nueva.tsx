import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { createTemplate, getWhatsappSettings } from "#/server/whatsapp.functions.ts";

import { templateRefusalMessages } from "#/lib/whatsapp-template-copy.ts";

import { TemplateForm } from "#/routes/_app/whatsapp/plantillas/-template-form.tsx";

export const Route = createFileRoute("/_app/whatsapp/plantillas/nueva")({
  head: () => ({ meta: [{ title: "Nueva plantilla · underthing" }] }),
  loader: () => getWhatsappSettings(),
  component: NewTemplate,
});

function NewTemplate() {
  const settings = Route.useLoaderData();
  if (!settings.ok) {
    return <RefusalMessage message={templateRefusalMessages[settings.reason]} />;
  }
  const missing = settings.templateMissing && templateRefusalMessages[settings.templateMissing];
  return (
    <TemplateForm
      templateId={null}
      settings={{ name: "", timing: { when: "before", hours: 24 } }}
      body=""
      sentBody={null}
      organizationName={settings.organizationName}
      title="Nueva plantilla"
      description="Un mensaje del consultorio a los pacientes de las prestaciones que la envíen."
      submitLabel={() => "Crear y enviar a Meta"}
      versionNote="Al crearla, se envía a Meta, que la revisa antes de que se pueda usar."
      lead={
        missing && (
          <Alert variant="warning">
            <AlertTitle>No se pueden enviar plantillas a Meta</AlertTitle>
            <AlertDescription>{missing}</AlertDescription>
          </Alert>
        )
      }
      save={async (values) => {
        const created = await createTemplate({
          data: { body: values.body, name: values.settings!.name, timing: values.settings!.timing },
        });
        return created.ok ? { ok: true } : created;
      }}
    />
  );
}
