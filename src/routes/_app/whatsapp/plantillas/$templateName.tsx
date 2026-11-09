import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage, useFormAction } from "#/components/admin-form.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { FormPage, useFormPage } from "#/components/form-page.tsx";
import type { FieldProblem } from "#/components/form-problems.ts";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import {
  checkTemplateBody,
  templateNames,
  templateSubmissionSchema,
  whatsappTemplates,
} from "#/lib/whatsapp-templates.ts";
import type { TemplateName, TemplateProblem } from "#/lib/whatsapp-templates.ts";
import { getWhatsappSettings, submitWhatsappTemplate } from "#/server/whatsapp.functions.ts";

import {
  problemText,
  rejectionText,
  templateLabels,
  templateRefusalMessages,
  templateStatusLabels,
  templateStatusVariants,
} from "#/routes/_app/whatsapp/-template-copy.ts";

export const Route = createFileRoute("/_app/whatsapp/plantillas/$templateName")({
  head: () => ({ meta: [{ title: "Plantilla de WhatsApp · underthing" }] }),
  loader: () => getWhatsappSettings(),
  component: EditTemplate,
});

const refusalMessages = {
  ...templateRefusalMessages,
  // The body's own problems show under it; this is what an unexpected one says.
  invalidTemplate: "Revisá el texto de la plantilla.",
  metaRefused: "Meta rechazó la plantilla.",
  alreadySubmitting:
    "Esta plantilla ya se está enviando a Meta. Esperá a que termine y volvé a intentar.",
};

const notFound = "No encontramos esa plantilla.";

function isTemplateName(name: string): name is TemplateName {
  return (templateNames as string[]).includes(name);
}

function EditTemplate() {
  const listed = Route.useLoaderData();
  const { templateName } = Route.useParams();
  if (!listed.ok) {
    return <RefusalMessage message={templateRefusalMessages[listed.reason]} />;
  }
  const template = listed.templates.find((one) => one.name === templateName);
  if (!template || !isTemplateName(templateName)) {
    return <RefusalMessage message={notFound} />;
  }
  return <TemplateForm name={templateName} latest={template.versions[0]} />;
}

type Version = Extract<
  Awaited<ReturnType<typeof getWhatsappSettings>>,
  { ok: true }
>["templates"][number]["versions"][number];

/** The body's problems, as the one problem under its field. */
function bodyProblem(problems: TemplateProblem[]): FieldProblem[] {
  return [{ field: "body", message: problems.map(problemText).join(" ") }];
}

function TemplateForm(props: { name: TemplateName; latest: Version | undefined }) {
  const { name, latest } = props;
  const page = useFormPage({ to: "/whatsapp" });
  const action = useFormAction(refusalMessages);
  const variables = whatsappTemplates[name].variables.map((one) => "{{" + one + "}}").join(", ");

  const form = useAppForm({
    defaultValues: { body: latest?.body ?? whatsappTemplates[name].draft },
    onSubmit: async ({ value }) => {
      const input = templateSubmissionSchema.safeParse({ templateName: name, body: value.body });
      if (!input.success) {
        page.showProblems([{ field: "body", message: refusalMessages.invalidInput }]);
        return;
      }
      const checked = checkTemplateBody(name, input.data.body);
      if (!checked.ok) {
        page.showProblems(bodyProblem(checked.problems));
        return;
      }
      // Meta's own words for a refusal, read inside the action.
      const meta: { message: string | null } = { message: null };
      const submitted = await action.save(async () => {
        const result = await submitWhatsappTemplate({
          data: input.data,
        });
        if (!result.ok && result.reason === "invalidTemplate") {
          page.showProblems(bodyProblem(result.problems));
        }
        if (!result.ok && result.reason === "metaRefused") {
          meta.message = result.metaError.message;
        }
        return result.ok ? { ok: true } : { ok: false, reason: result.reason };
      });
      if (submitted) {
        page.leave();
      } else if (meta.message) {
        action.setError(`${refusalMessages.metaRefused} ${meta.message}`);
      }
    },
  });

  const description = latest
    ? `Versión ${latest.version} en Meta. Al enviarla, se crea la versión ${latest.version + 1}, que Meta revisa de nuevo.`
    : "Todavía no se envió a Meta. Al enviarla, Meta la revisa antes de que se pueda usar.";

  return (
    <FormPage
      page={page}
      form={form}
      title={templateLabels[name]}
      description={description}
      submitLabel="Enviar a Meta"
      pending={action.pending}
      refusals={action.error ? [{ field: "", message: action.error }] : undefined}
      onClear={() => action.setError(null)}
      record={{
        status: latest && (
          <Badge variant={templateStatusVariants[latest.status]}>
            {templateStatusLabels[latest.status]}
          </Badge>
        ),
        actions: () => null,
        error: null,
      }}
      lead={
        latest?.status === "rejected" && (
          <Alert variant="destructive">
            <AlertTitle>Meta rechazó la versión {latest.version}</AlertTitle>
            <AlertDescription>
              {latest.rejectionReason
                ? rejectionText(latest.rejectionReason)
                : "Meta no dio el motivo."}{" "}
              Corregí el texto y enviá una versión nueva.
            </AlertDescription>
          </Alert>
        )
      }
    >
      <form.AppField name="body">
        {(field) => (
          <field.TextareaField
            label="Texto"
            required
            hint={`Podés usar ${variables}. Escribí la firma del consultorio en lugar de [firma]. Hasta 1024 caracteres, sin empezar ni terminar con una variable.`}
          />
        )}
      </form.AppField>
    </FormPage>
  );
}
