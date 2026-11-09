import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage, useFormAction } from "#/components/admin-form.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { handoffRemindersSchema, maxReminderHours } from "#/lib/handoffs.ts";
import { getWhatsappSettings, saveHandoffReminders } from "#/server/whatsapp.functions.ts";

import { handoffRemindersHint } from "#/routes/_app/whatsapp/-handoff-reminders.tsx";

export const Route = createFileRoute("/_app/whatsapp/recordatorios")({
  head: () => ({ meta: [{ title: "Recordatorios de derivaciones · underthing" }] }),
  loader: () => getWhatsappSettings(),
  component: EditHandoffReminders,
});

const wrongHours = `Ingresá una cantidad entera de horas, de 1 a ${maxReminderHours}.`;

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador puede cambiar los recordatorios de derivaciones.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: wrongHours,
};

function EditHandoffReminders() {
  const settings = Route.useLoaderData();
  if (!settings.ok) {
    return <RefusalMessage message={refusalMessages[settings.reason]} />;
  }
  return <HandoffRemindersForm {...settings.handoffReminders} />;
}

/** Whole hours from a field, or `NaN` for an empty one. */
function hoursOf(text: string) {
  return Number(text.trim() || Number.NaN);
}

function HandoffRemindersForm(props: { recipientHours: number; othersHours: number }) {
  const page = useFormPage({ to: "/whatsapp" });
  const action = useFormAction(refusalMessages);

  const form = useAppForm({
    defaultValues: {
      recipientHours: String(props.recipientHours),
      othersHours: String(props.othersHours),
    },
    onSubmit: async ({ value }) => {
      const input = {
        recipientHours: hoursOf(value.recipientHours),
        othersHours: hoursOf(value.othersHours),
      };
      const parsed = handoffRemindersSchema.safeParse(input);
      if (!parsed.success) {
        const wrong = new Set(parsed.error.issues.map((issue) => String(issue.path[0])));
        page.showProblems([...wrong].map((field) => ({ field, message: wrongHours })));
        return;
      }
      if (await action.save(() => saveHandoffReminders({ data: parsed.data }))) {
        page.leave();
      }
    },
  });

  const hint = `Horas antes del cierre, de 1 a ${maxReminderHours}.`;
  return (
    <ActionFormPage
      page={page}
      form={form}
      action={action}
      title="Recordatorios de derivaciones"
      description={handoffRemindersHint}
      submitLabel="Guardar"
    >
      <form.AppField name="recipientHours">
        {(field) => (
          <field.TextField
            label="A quien la recibe"
            type="number"
            min={1}
            max={maxReminderHours}
            step={1}
            required
            narrow
            hint={hint}
          />
        )}
      </form.AppField>
      <form.AppField name="othersHours">
        {(field) => (
          <field.TextField
            label="A los demás que pueden responderla"
            type="number"
            min={1}
            max={maxReminderHours}
            step={1}
            required
            narrow
            hint={hint}
          />
        )}
      </form.AppField>
    </ActionFormPage>
  );
}
