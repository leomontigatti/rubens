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

const noHours = "Ingresá las horas.";

const othersFirst =
  "A los demás se les recuerda más cerca del cierre: ingresá las mismas horas o menos que para quien la recibe.";

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

const fieldNames = ["recipientHours", "othersHours"] as const;

/** Whole hours from a field, or `NaN` for an empty one. */
function hoursOf(text: string) {
  return Number(text.trim() || Number.NaN);
}

/** What is wrong with the hours `value` holds, by field: empty ones first, then the schema's refusals. */
function hoursProblems(value: Record<(typeof fieldNames)[number], string>) {
  const empty = fieldNames.filter((field) => value[field].trim() === "");
  if (empty.length > 0) {
    return empty.map((field) => ({ field, message: noHours }));
  }
  const parsed = handoffRemindersSchema.safeParse({
    recipientHours: hoursOf(value.recipientHours),
    othersHours: hoursOf(value.othersHours),
  });
  if (parsed.success) {
    return { hours: parsed.data };
  }
  return parsed.error.issues.map((issue) => ({
    field: String(issue.path[0]),
    message: issue.message === "othersBeforeRecipients" ? othersFirst : wrongHours,
  }));
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
      const checked = hoursProblems(value);
      if (Array.isArray(checked)) {
        page.showProblems(checked);
        return;
      }
      if (await action.save(() => saveHandoffReminders({ data: checked.hours }))) {
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
