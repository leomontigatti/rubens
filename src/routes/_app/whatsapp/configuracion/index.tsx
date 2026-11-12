import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { templateRefusalMessages } from "#/lib/whatsapp-template-copy.ts";
import { getWhatsappSettings } from "#/server/whatsapp.functions.ts";

import { CommunicationRulesSection } from "#/routes/_app/whatsapp/configuracion/-communication-rules.tsx";
import { HandoffContactsSection } from "#/routes/_app/whatsapp/configuracion/-handoff-contacts.tsx";
import { MessagesSection } from "#/routes/_app/whatsapp/configuracion/-messages.tsx";
import { HandoffRemindersSection } from "#/routes/_app/whatsapp/configuracion/-handoff-reminders.tsx";
import { NumberSection } from "#/routes/_app/whatsapp/configuracion/-number.tsx";
import { ReturnTimeSection } from "#/routes/_app/whatsapp/configuracion/-return-time.tsx";
import { SandboxSection } from "#/routes/_app/whatsapp/configuracion/-sandbox.tsx";

export const Route = createFileRoute("/_app/whatsapp/configuracion/")({
  head: () => ({ meta: [{ title: "Configuración de WhatsApp · underthing" }] }),
  loader: () => getWhatsappSettings(),
  component: WhatsappSettings,
});

function WhatsappSettings() {
  const settings = Route.useLoaderData();
  if (!settings.ok) {
    return <RefusalMessage message={templateRefusalMessages[settings.reason]} />;
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Configuración"
        description="Cómo la organización escribe a los pacientes por WhatsApp."
      />
      <NumberSection settings={settings} />
      <CommunicationRulesSection settings={settings} />
      <HandoffContactsSection settings={settings} />
      <HandoffRemindersSection settings={settings} />
      <ReturnTimeSection settings={settings} />
      <MessagesSection settings={settings} />
      <SandboxSection />
    </div>
  );
}
