import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage, useFormAction } from "#/components/admin-form.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { handoffContactsSchema } from "#/lib/handoff-contacts.ts";
import type { HandoffContactCandidate } from "#/organization/handoff-contacts.ts";
import { getHandoffContacts, saveHandoffContacts } from "#/server/whatsapp.functions.ts";

import {
  handoffContactsHint,
  keepsRecordsLabel,
} from "#/routes/_app/whatsapp/configuracion/-handoff-contacts.tsx";

export const Route = createFileRoute("/_app/whatsapp/configuracion/contactos")({
  head: () => ({ meta: [{ title: "Contactos de derivación · underthing" }] }),
  loader: () => getHandoffContacts(),
  component: EditHandoffContacts,
});

const noClinicalContact = "Elegí al menos un profesional que lleve historias clínicas.";

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador puede elegir los contactos de derivación.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "Alguna de esas personas ya no está activa. Volvé a cargar la página.",
  noClinicalContact,
};

const refusalFields: Partial<Record<keyof typeof refusalMessages, string>> = {
  noClinicalContact: "memberIds",
};

function EditHandoffContacts() {
  const listed = Route.useLoaderData();
  if (!listed.ok) {
    return <RefusalMessage message={refusalMessages[listed.reason]} />;
  }
  return <ContactsForm members={listed.members} />;
}

function ContactsForm({ members }: { members: HandoffContactCandidate[] }) {
  const page = useFormPage({ to: "/whatsapp/configuracion" });
  const action = useFormAction(refusalMessages, refusalFields);
  const options = members.map((one) => ({
    value: one.memberId,
    label: one.keepsClinicalRecords ? `${one.name} · ${keepsRecordsLabel}` : one.name,
  }));
  const clinicalMemberIds = new Set(
    members.filter((one) => one.keepsClinicalRecords).map((one) => one.memberId),
  );

  const form = useAppForm({
    defaultValues: {
      memberIds: members.filter((one) => one.handoffContact).map((one) => one.memberId),
    },
    onSubmit: async ({ value }) => {
      const parsed = handoffContactsSchema.safeParse(value);
      if (!parsed.success) {
        page.showProblems([{ field: "memberIds", message: refusalMessages.invalidInput }]);
        return;
      }
      if (!parsed.data.memberIds.some((memberId) => clinicalMemberIds.has(memberId))) {
        page.showProblems([{ field: "memberIds", message: noClinicalContact }]);
        return;
      }
      if (await action.save(() => saveHandoffContacts({ data: parsed.data }))) {
        page.leave();
      }
    },
  });

  return (
    <ActionFormPage
      page={page}
      form={form}
      action={action}
      title="Contactos de derivación"
      description={handoffContactsHint}
      submitLabel="Guardar"
    >
      <form.AppField name="memberIds">
        {(field) => <field.CheckboxGroupField legend="Contactos" options={options} />}
      </form.AppField>
    </ActionFormPage>
  );
}
