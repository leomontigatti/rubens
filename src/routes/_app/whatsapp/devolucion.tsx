import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage, useFormAction } from "#/components/admin-form.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { maxReturnAfterHours, returnTimeSchema } from "#/lib/conversation-holds.ts";
import { getWhatsappSettings, saveReturnTime } from "#/server/whatsapp.functions.ts";

import { returnTimeHint } from "#/routes/_app/whatsapp/-return-time.tsx";

export const Route = createFileRoute("/_app/whatsapp/devolucion")({
  head: () => ({ meta: [{ title: "Devolución al asistente · underthing" }] }),
  loader: () => getWhatsappSettings(),
  component: EditReturnTime,
});

const wrongHours = `Ingresá una cantidad entera de horas, de 1 a ${maxReturnAfterHours}.`;

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador puede cambiar cuándo vuelve una conversación al asistente.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: wrongHours,
};

const refusalFields: Partial<Record<keyof typeof refusalMessages, string>> = {
  invalidInput: "hours",
};

function EditReturnTime() {
  const settings = Route.useLoaderData();
  if (!settings.ok) {
    return <RefusalMessage message={refusalMessages[settings.reason]} />;
  }
  return <ReturnTimeForm hours={settings.returnAfterHours} />;
}

function ReturnTimeForm(props: { hours: number }) {
  const page = useFormPage({ to: "/whatsapp" });
  const action = useFormAction(refusalMessages, refusalFields);

  const form = useAppForm({
    defaultValues: { hours: String(props.hours) },
    onSubmit: async ({ value }) => {
      const parsed = returnTimeSchema.safeParse({
        hours: Number(value.hours.trim() || Number.NaN),
      });
      if (!parsed.success) {
        page.showProblems([{ field: "hours", message: wrongHours }]);
        return;
      }
      if (await action.save(() => saveReturnTime({ data: parsed.data }))) {
        page.leave();
      }
    },
  });

  return (
    <ActionFormPage
      page={page}
      form={form}
      action={action}
      title="Devolución al asistente"
      description={returnTimeHint}
      submitLabel="Guardar"
    >
      <form.AppField name="hours">
        {(field) => (
          <field.TextField
            label="Horas"
            type="number"
            min={1}
            max={maxReturnAfterHours}
            step={1}
            required
            narrow
            hint={`De 1 a ${maxReturnAfterHours} horas.`}
          />
        )}
      </form.AppField>
    </ActionFormPage>
  );
}
