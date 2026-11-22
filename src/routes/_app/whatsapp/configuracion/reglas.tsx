import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage, useFormAction } from "#/components/admin-form.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { phoneMessages } from "#/components/phone-field.tsx";
import {
  formsOfAddress,
  maxToneLength,
  parseCommunicationRules,
} from "#/lib/communication-rules.ts";
import type { CommunicationRulesInput } from "#/lib/communication-rules.ts";
import { splitPhone } from "#/lib/phones.ts";
import { getWhatsappSettings, saveCommunicationRules } from "#/server/whatsapp.functions.ts";

import { formOfAddressLabels } from "#/routes/_app/whatsapp/configuracion/-communication-rules.tsx";
import { fixedCrumbs } from "#/components/app-breadcrumbs.tsx";

export const Route = createFileRoute("/_app/whatsapp/configuracion/reglas")({
  head: () => ({ meta: [{ title: "Reglas de comunicación · underthing" }] }),
  loader: () => getWhatsappSettings(),
  staticData: { crumbs: fixedCrumbs("Reglas de comunicación") },
  component: EditCommunicationRules,
});

const toneTooLong = `Acortá el tono a ${maxToneLength} caracteres como máximo.`;

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador puede cambiar las reglas de comunicación.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  toneTooLong,
  ...phoneMessages,
};

const refusalFields: Partial<Record<keyof typeof refusalMessages, string>> = {
  toneTooLong: "tone",
  notDigits: "phone",
  wrongArgentineNumber: "phone",
  invalidPhone: "phone",
};

function EditCommunicationRules() {
  const settings = Route.useLoaderData();
  if (!settings.ok) {
    return <RefusalMessage message={refusalMessages[settings.reason]} />;
  }
  return <RulesForm initial={settings.communicationRules} />;
}

function RulesForm(props: { initial: Omit<CommunicationRulesInput, "phone"> & { phone: string } }) {
  const { initial } = props;
  const page = useFormPage({ to: "/whatsapp/configuracion" });
  const action = useFormAction(refusalMessages, refusalFields);

  const form = useAppForm({
    defaultValues: {
      formOfAddress: initial.formOfAddress,
      tone: initial.tone,
      phone: splitPhone(initial.phone),
    },
    onSubmit: async ({ value }) => {
      const parsed = parseCommunicationRules(value);
      if (!parsed.ok) {
        const field = refusalFields[parsed.reason] ?? "";
        page.showProblems([{ field, message: refusalMessages[parsed.reason] }]);
        return;
      }
      if (
        await action.save(() =>
          saveCommunicationRules({ data: { ...parsed.rules, phone: value.phone } }),
        )
      ) {
        page.leave();
      }
    },
  });

  return (
    <ActionFormPage
      page={page}
      form={form}
      action={action}
      title="Reglas de comunicación"
      submitLabel="Guardar"
    >
      <form.AppField name="formOfAddress">
        {(field) => (
          <field.SelectField
            label="Trato"
            required
            options={formsOfAddress.map((one) => ({ value: one, label: formOfAddressLabels[one] }))}
          />
        )}
      </form.AppField>
      <form.AppField name="tone">
        {(field) => (
          <field.TextareaField
            label="Tono"
            hint={`Cómo querés que suene, en pocas palabras. Hasta ${maxToneLength} caracteres. No cambia lo que el asistente puede hacer.`}
          />
        )}
      </form.AppField>
      <form.AppField name="phone">
        {(field) => (
          <field.PhoneField
            label="Teléfono para urgencias"
            hint="El teléfono de la organización que el asistente da, junto al 107, cuando un mensaje parece una urgencia. Sin teléfono, da solo el 107."
          />
        )}
      </form.AppField>
    </ActionFormPage>
  );
}
