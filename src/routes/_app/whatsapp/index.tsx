import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { ErrorAlert, RefusalMessage } from "#/components/admin-form.tsx";
import { FormProblemsContext, useAppForm } from "#/components/app-form.tsx";
import { focusProblem } from "#/components/form-page.tsx";
import { fieldProblems } from "#/components/form-problems.ts";
import type { FieldProblem } from "#/components/form-problems.ts";
import { PageHeader } from "#/components/page-header.tsx";
import { RecordSection } from "#/components/record-section.tsx";
import { serverAnswer, shownPath } from "#/components/save-failure.ts";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Button } from "#/components/ui/button.tsx";
import { FieldGroup } from "#/components/ui/field.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { defaultTemplate, templateSendSchema } from "#/lib/whatsapp.ts";
import type { TemplateSend } from "#/lib/whatsapp.ts";
import { getWhatsappSettings, sendWhatsappTemplate } from "#/server/whatsapp.functions.ts";

import { CommunicationRulesSection } from "#/routes/_app/whatsapp/-communication-rules.tsx";
import { HandoffContactsSection } from "#/routes/_app/whatsapp/-handoff-contacts.tsx";
import { NumberSection } from "#/routes/_app/whatsapp/-number.tsx";
import { ReturnTimeSection } from "#/routes/_app/whatsapp/-return-time.tsx";
import { TemplateList } from "#/routes/_app/whatsapp/-templates.tsx";

export const Route = createFileRoute("/_app/whatsapp/")({
  head: () => ({ meta: [{ title: "WhatsApp · underthing" }] }),
  loader: () => getWhatsappSettings(),
  component: WhatsappSettings,
});

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador puede usar la configuración de WhatsApp.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá el número, la plantilla y el idioma.",
  connectionFailed: "La conexión del número de WhatsApp falló. Conectalo de nuevo.",
  missingAccessToken:
    "Falta el token de acceso de WhatsApp: conectá el número del consultorio, o revisá la configuración del servidor.",
  missingPhoneNumberId:
    "Falta el identificador del número de WhatsApp en la configuración del servidor.",
};

// Meta's test numbers only reach the recipients listed in its dashboard, and it
// lists an Argentine mobile without its `9`: a number typed with it is refused.
const recipientHint =
  "Escribilo como figura en los destinatarios de Meta, por ejemplo +54 351 555-1234.";

const wrongPhone = "Ingresá el número con su código de área, por ejemplo +54 351 555-1234.";

// Each field's copy when it is empty, and when what it holds is wrong.
const fieldMessages: Record<keyof TemplateSend, { empty: string; wrong: string }> = {
  to: { empty: "Ingresá el número del destinatario.", wrong: wrongPhone },
  templateName: {
    empty: "Ingresá el nombre de la plantilla.",
    wrong: "Usá el nombre de la plantilla en Meta, por ejemplo hello_world.",
  },
  languageCode: {
    empty: "Ingresá el idioma.",
    wrong: "Usá el código de idioma de la plantilla en Meta, por ejemplo en_US o es_AR.",
  },
};

/** What the last send answered, shown above the form. */
type Answer =
  | { kind: "sent"; messageId: string }
  | { kind: "metaRefused"; message: string }
  | { kind: "refused"; message: string };

/** A field's copy for what the schema refused in `value`: empty or wrong. */
function messageIn(value: TemplateSend) {
  return (issue: { path: PropertyKey[] }) => {
    const field = String(issue.path.at(-1)) as keyof TemplateSend;
    return value[field].trim() ? fieldMessages[field].wrong : fieldMessages[field].empty;
  };
}

type SendAnswer = Awaited<ReturnType<typeof sendWhatsappTemplate>>;

/** Where the page shows the server's answer: above the form, or under the number. */
function shownFor(result: SendAnswer): { answer?: Answer; problems?: FieldProblem[] } {
  if (result.ok) {
    return { answer: { kind: "sent", messageId: result.messageId } };
  }
  if (result.reason === "metaRefused") {
    return { answer: { kind: "metaRefused", message: result.metaError.message } };
  }
  if (result.reason === "invalidPhone" || result.reason === "missingAreaCode") {
    return { problems: [{ field: "to", message: wrongPhone }] };
  }
  return { answer: { kind: "refused", message: refusalMessages[result.reason] } };
}

function WhatsappSettings() {
  const settings = Route.useLoaderData();
  const router = useRouter();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [problems, setProblems] = useState<FieldProblem[]>([]);
  const [shown, setShown] = useState(0);
  const content = useRef<HTMLDivElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (shown > 0) {
      focusProblem(content.current, answerRef.current);
    }
  }, [shown]);

  function show(next: { answer?: Answer; problems?: FieldProblem[] }) {
    setAnswer(next.answer ?? null);
    setProblems(next.problems ?? []);
    setShown((count) => count + 1);
  }

  const form = useAppForm({
    defaultValues: { to: "", ...defaultTemplate } as TemplateSend,
    onSubmit: async ({ value }) => {
      const input = templateSendSchema.safeParse(value);
      if (!input.success) {
        show({ problems: fieldProblems(input.error.issues, messageIn(value)) });
        return;
      }
      setAnswer(null);
      setProblems([]);
      const result = await serverAnswer("whatsapp-send", shownPath(router), () =>
        sendWhatsappTemplate({ data: input.data }),
      );
      if (result) {
        show(shownFor(result));
      }
    },
  });

  if (!settings.ok) {
    return <RefusalMessage message={refusalMessages[settings.reason]} />;
  }
  const disabledReason = settings.missing && refusalMessages[settings.missing];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="WhatsApp"
        description="El número del consultorio, las plantillas con las que escribe a los pacientes, cómo escribe el asistente, a quién deriva, cuándo vuelve a responder una conversación tomada y un envío de prueba."
      />
      <NumberSection settings={settings} />
      <TemplateList settings={settings} />
      <CommunicationRulesSection settings={settings} />
      <HandoffContactsSection settings={settings} />
      <ReturnTimeSection settings={settings} />
      <RecordSection title="Envío de prueba">
        <div className="flex max-w-xl flex-col gap-6">
          <p className="text-muted-foreground text-sm">
            Enviá una plantilla aprobada por Meta, sin variables, a un número de prueba.
          </p>
          {disabledReason && (
            <Alert variant="warning">
              <AlertTitle>No se pueden enviar mensajes</AlertTitle>
              <AlertDescription>{disabledReason}</AlertDescription>
            </Alert>
          )}
          <FormProblemsContext.Provider value={problems}>
            <div ref={content} className="flex flex-col gap-6">
              {answer && (
                <div ref={answerRef} tabIndex={-1} className="outline-none">
                  <AnswerAlert answer={answer} />
                </div>
              )}
              <form
                method="post"
                noValidate
                className="flex flex-col gap-6"
                onSubmit={(event) => {
                  event.preventDefault();
                  void form.handleSubmit();
                }}
              >
                <FieldGroup>
                  <form.AppField name="to">
                    {(field) => (
                      <field.TextField
                        label="Número del destinatario"
                        type="tel"
                        required
                        hint={recipientHint}
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="templateName">
                    {(field) => <field.TextField label="Plantilla" required />}
                  </form.AppField>
                  <form.AppField name="languageCode">
                    {(field) => <field.TextField label="Idioma" required narrow />}
                  </form.AppField>
                </FieldGroup>
                <form.Subscribe selector={(state) => state.isSubmitting}>
                  {(submitting) => (
                    <Button
                      type="submit"
                      className="w-fit"
                      disabled={Boolean(disabledReason) || submitting}
                    >
                      {submitting && <Spinner />}
                      Enviar plantilla
                    </Button>
                  )}
                </form.Subscribe>
              </form>
            </div>
          </FormProblemsContext.Provider>
        </div>
      </RecordSection>
    </div>
  );
}

function AnswerAlert({ answer }: { answer: Answer }) {
  if (answer.kind === "refused") {
    return <ErrorAlert message={answer.message} />;
  }
  if (answer.kind === "metaRefused") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Meta rechazó el envío</AlertTitle>
        <AlertDescription>{answer.message}</AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="success">
      <AlertTitle>Meta aceptó el mensaje</AlertTitle>
      <AlertDescription>Identificador: {answer.messageId}</AlertDescription>
    </Alert>
  );
}
