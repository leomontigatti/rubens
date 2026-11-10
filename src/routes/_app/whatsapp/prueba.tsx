import { createFileRoute, useRouter } from "@tanstack/react-router";
import { CalendarIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ErrorAlert, RefusalMessage } from "#/components/admin-form.tsx";
import { FormProblemsContext, useAppForm } from "#/components/app-form.tsx";
import type { FieldProblem } from "#/components/form-problems.ts";
import { EmptyState } from "#/components/empty-state.tsx";
import { focusProblem } from "#/components/form-page.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { RecordSection } from "#/components/record-section.tsx";
import { serverAnswer, shownPath } from "#/components/save-failure.ts";
import { Button } from "#/components/ui/button.tsx";
import { NativeSelectOption } from "#/components/ui/native-select.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { PatientBubble, WhatsappBubble, WhatsappChat } from "#/components/whatsapp-bubble.tsx";
import { sandboxRefusalMessages, scenarioLabel } from "#/lib/assistant-sandbox-copy.ts";
import { sandboxTurnSchema } from "#/lib/assistant-sandbox.ts";
import { getSandboxScenarios, playSandboxTurn, startSandbox } from "#/server/whatsapp.functions.ts";

import { SandboxLastTurn, SandboxState } from "#/routes/_app/whatsapp/-sandbox-turn.tsx";
import type { Played } from "#/routes/_app/whatsapp/-sandbox-turn.tsx";

// The assistant's sandbox (docs/domain/assistant.md § Trying it): the admin
// picks a scenario, an upcoming appointment whose reminder was just sent, and
// writes as its patient; the real assistant answers, and nothing is kept.

export const Route = createFileRoute("/_app/whatsapp/prueba")({
  head: () => ({ meta: [{ title: "Prueba del asistente · underthing" }] }),
  loader: () => getSandboxScenarios(),
  component: AssistantSandbox,
});

type Scenario = Extract<
  Awaited<ReturnType<typeof getSandboxScenarios>>,
  { ok: true }
>["scenarios"][number];

const description =
  "Escribí como el paciente y mirá cómo responde el asistente, con sus herramientas reales sobre la agenda real. Nada se guarda: no cambia ningún turno, no se envía nada por WhatsApp y la conversación no aparece en Conversaciones. Cuenta en el uso del asistente.";

function AssistantSandbox() {
  const listed = Route.useLoaderData();
  if (!listed.ok) {
    return <RefusalMessage message={sandboxRefusalMessages[listed.reason]} />;
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Prueba del asistente" description={description} />
      {listed.scenarios.length === 0 ? (
        <EmptyState
          icon={CalendarIcon}
          title="Sin turnos próximos"
          description="La prueba empieza desde el recordatorio de un turno próximo de un paciente con WhatsApp. Todavía no hay ninguno."
        />
      ) : (
        <Sandbox scenarios={listed.scenarios} />
      )}
    </div>
  );
}

/** The sandbox conversation shown: as it started, or after its latest turn. */
type Shown = Pick<Played, "sandbox" | "windowClosesAt"> & { turn: Played["turn"] | null };

function Sandbox({ scenarios }: { scenarios: Scenario[] }) {
  const router = useRouter();
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<FieldProblem[]>([]);
  // Each refusal shown takes the focus: the refused field, or the alert above the conversation.
  const [shownRefusals, setShownRefusals] = useState(0);
  const content = useRef<HTMLDivElement>(null);
  /** The conversation started last, which a turn's answer must belong to. */
  const started = useRef<string | null>(null);
  const alert = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (shownRefusals > 0) {
      focusProblem(content.current, alert.current);
    }
  }, [shownRefusals]);

  function refuse(next: { error?: string; problems?: FieldProblem[] }) {
    setError(next.error ?? null);
    setProblems(next.problems ?? []);
    setShownRefusals((count) => count + 1);
  }

  const scenarioForm = useAppForm({
    defaultValues: { appointmentId: scenarios[0]!.appointmentId },
    onSubmit: async ({ value }) => {
      setError(null);
      const result = await serverAnswer("sandbox-start", shownPath(router), () =>
        startSandbox({ data: value }),
      );
      if (!result) {
        return;
      }
      if (!result.ok) {
        refuse({ error: sandboxRefusalMessages[result.reason] });
        return;
      }
      started.current = result.sandbox.conversationId;
      // A refusal of the earlier conversation's turn may have come while this one started.
      setError(null);
      setShown({ sandbox: result.sandbox, windowClosesAt: null, turn: null });
      messageForm.reset();
    },
  });

  const messageForm = useAppForm({
    defaultValues: { text: "" },
    onSubmit: async ({ value }) => {
      if (!shown) {
        return;
      }
      const input = sandboxTurnSchema.safeParse({ state: shown.sandbox, text: value.text });
      if (!input.success) {
        refuse({ problems: [{ field: "text", message: sandboxRefusalMessages.invalidInput }] });
        return;
      }
      setProblems([]);
      setError(null);
      const result = await serverAnswer("sandbox-turn", shownPath(router), () =>
        playSandboxTurn({ data: input.data }),
      );
      // A conversation started again while the turn ran is the one shown now.
      if (!result || started.current !== input.data.state.conversationId) {
        return;
      }
      if (!result.ok) {
        refuse({ error: sandboxRefusalMessages[result.reason] });
        return;
      }
      setShown(result);
      messageForm.reset();
    },
  });

  return (
    <>
      <RecordSection title="Escenario">
        <form
          method="post"
          noValidate
          className="flex flex-wrap items-end gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void scenarioForm.handleSubmit();
          }}
        >
          <scenarioForm.AppField name="appointmentId">
            {(field) => (
              <field.SelectField
                label="Turno"
                hint="La conversación empieza con el recordatorio de este turno, recién enviado."
              >
                {scenarios.map((scenario) => (
                  <NativeSelectOption key={scenario.appointmentId} value={scenario.appointmentId}>
                    {scenarioLabel(scenario)}
                  </NativeSelectOption>
                ))}
              </field.SelectField>
            )}
          </scenarioForm.AppField>
          <scenarioForm.Subscribe selector={(state) => state.isSubmitting}>
            {(submitting) => (
              <Button type="submit" variant={shown ? "outline" : "default"} disabled={submitting}>
                {submitting && <Spinner />}
                {shown ? "Empezar de nuevo" : "Empezar"}
              </Button>
            )}
          </scenarioForm.Subscribe>
        </form>
      </RecordSection>
      {error && (
        <div ref={alert} tabIndex={-1} className="outline-none">
          <ErrorAlert message={error} />
        </div>
      )}
      {shown && (
        <div className="grid items-start gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RecordSection title="Conversación">
              <div className="flex flex-col gap-4">
                <WhatsappChat label="La conversación de prueba">
                  {shown.sandbox.messages.map((message, index) =>
                    message.direction === "incoming" ? (
                      <PatientBubble key={index}>{message.text}</PatientBubble>
                    ) : (
                      <WhatsappBubble key={index}>{message.text}</WhatsappBubble>
                    ),
                  )}
                </WhatsappChat>
                <FormProblemsContext.Provider value={problems}>
                  <div ref={content}>
                    <form
                      method="post"
                      noValidate
                      className="flex flex-col gap-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void messageForm.handleSubmit();
                      }}
                    >
                      <messageForm.AppField name="text">
                        {(field) => <field.TextareaField label="Mensaje del paciente" />}
                      </messageForm.AppField>
                      <messageForm.Subscribe selector={(state) => state.isSubmitting}>
                        {(submitting) => (
                          <Button type="submit" className="w-fit" disabled={submitting}>
                            {submitting && <Spinner />}
                            Enviar como el paciente
                          </Button>
                        )}
                      </messageForm.Subscribe>
                    </form>
                  </div>
                </FormProblemsContext.Provider>
              </div>
            </RecordSection>
          </div>
          <div className="flex flex-col gap-6">
            <SandboxState sandbox={shown.sandbox} windowClosesAt={shown.windowClosesAt} />
            {shown.turn && <SandboxLastTurn turn={shown.turn} />}
          </div>
        </div>
      )}
    </>
  );
}
