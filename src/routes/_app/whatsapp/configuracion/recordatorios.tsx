import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage, useFormAction } from "#/components/admin-form.tsx";
import { SelectOptions, useAppForm } from "#/components/app-form.tsx";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { handoffRemindersSchema } from "#/lib/handoffs.ts";
import { handoffReminderChoices } from "#/lib/hour-choices.ts";
import { getWhatsappSettings, saveHandoffReminders } from "#/server/whatsapp.functions.ts";

import { handoffRemindersHint } from "#/routes/_app/whatsapp/configuracion/-handoff-reminders.tsx";

export const Route = createFileRoute("/_app/whatsapp/configuracion/recordatorios")({
  head: () => ({ meta: [{ title: "Recordatorios de derivaciones · underthing" }] }),
  loader: () => getWhatsappSettings(),
  component: EditHandoffReminders,
});

const wrongHours = "Elegí las horas de la lista.";

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

/** What is wrong with the hours `value` holds, by field, as the schema refuses them. */
function hoursProblems(value: { recipientHours: string; othersHours: string }) {
  const parsed = handoffRemindersSchema.safeParse({
    recipientHours: Number(value.recipientHours),
    othersHours: Number(value.othersHours),
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
  const page = useFormPage({ to: "/whatsapp/configuracion" });
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

  const hint = "Horas antes del cierre.";
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
          <field.SelectField label="A quien la recibe" required hint={hint}>
            <SelectOptions options={handoffReminderChoices(props.recipientHours)} />
          </field.SelectField>
        )}
      </form.AppField>
      <form.AppField name="othersHours">
        {(field) => (
          <field.SelectField label="A los demás que pueden responderla" required hint={hint}>
            <SelectOptions options={handoffReminderChoices(props.othersHours)} />
          </field.SelectField>
        )}
      </form.AppField>
    </ActionFormPage>
  );
}
