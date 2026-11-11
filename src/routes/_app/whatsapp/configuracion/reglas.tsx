import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage, useFormAction } from "#/components/admin-form.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { NativeSelectOption } from "#/components/ui/native-select.tsx";
import {
  formsOfAddress,
  maxToneLength,
  parseCommunicationRules,
} from "#/lib/communication-rules.ts";
import type { CommunicationRulesInput } from "#/lib/communication-rules.ts";
import { formatPhone } from "#/lib/phones.ts";
import { getWhatsappSettings, saveCommunicationRules } from "#/server/whatsapp.functions.ts";

import { formOfAddressLabels } from "#/routes/_app/whatsapp/configuracion/-communication-rules.tsx";

export const Route = createFileRoute("/_app/whatsapp/configuracion/reglas")({
  head: () => ({ meta: [{ title: "Reglas de comunicación · underthing" }] }),
  loader: () => getWhatsappSettings(),
  component: EditCommunicationRules,
});

const toneTooLong = `Acortá el tono a ${maxToneLength} caracteres como máximo.`;

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador puede cambiar las reglas de comunicación.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  toneTooLong,
  invalidPhone: "El teléfono no es válido. Si es del exterior, empezá con + y el código del país.",
  missingAreaCode: "Ingresá el teléfono con su código de área, por ejemplo 0351 15 555-1234.",
};

const refusalFields: Partial<Record<keyof typeof refusalMessages, string>> = {
  toneTooLong: "tone",
  invalidPhone: "phone",
  missingAreaCode: "phone",
};

function EditCommunicationRules() {
  const settings = Route.useLoaderData();
  if (!settings.ok) {
    return <RefusalMessage message={refusalMessages[settings.reason]} />;
  }
  return <RulesForm initial={settings.communicationRules} />;
}

function RulesForm(props: { initial: CommunicationRulesInput & { version: number } }) {
  const { initial } = props;
  const page = useFormPage({ to: "/whatsapp/configuracion" });
  const action = useFormAction(refusalMessages, refusalFields);

  const form = useAppForm({
    defaultValues: {
      formOfAddress: initial.formOfAddress as string,
      tone: initial.tone,
      phone: initial.phone && formatPhone(initial.phone),
    },
    onSubmit: async ({ value }) => {
      const parsed = parseCommunicationRules(value);
      if (!parsed.ok) {
        const field = refusalFields[parsed.reason] ?? "";
        page.showProblems([{ field, message: refusalMessages[parsed.reason] }]);
        return;
      }
      if (await action.save(() => saveCommunicationRules({ data: parsed.rules }))) {
        page.leave();
      }
    },
  });

  const description = initial.version
    ? `Versión ${initial.version}. Al guardar, se crea la versión ${initial.version + 1}.`
    : "Todavía nadie las guardó: el asistente trata de vos.";

  return (
    <ActionFormPage
      page={page}
      form={form}
      action={action}
      title="Reglas de comunicación"
      description={description}
      submitLabel="Guardar"
    >
      <form.AppField name="formOfAddress">
        {(field) => (
          <field.SelectField label="Trato" required>
            {formsOfAddress.map((one) => (
              <NativeSelectOption key={one} value={one}>
                {formOfAddressLabels[one]}
              </NativeSelectOption>
            ))}
          </field.SelectField>
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
          <field.TextField
            label="Teléfono para urgencias"
            type="tel"
            hint="El teléfono del consultorio que el asistente da, junto al 107, cuando un mensaje parece una urgencia. Sin teléfono, da solo el 107."
          />
        )}
      </form.AppField>
    </ActionFormPage>
  );
}
