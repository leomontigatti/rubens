import { Link } from "@tanstack/react-router";

import { Detail, RecordSection } from "#/components/record-section.tsx";
import { Button } from "#/components/ui/button.tsx";
import type { FormOfAddress } from "#/lib/communication-rules.ts";
import type { getWhatsappSettings } from "#/server/whatsapp.functions.ts";

// The assistant's communication rules in the WhatsApp settings: how it
// addresses patients, its sign-off and its tone, edited on their own page.

type Settings = Extract<Awaited<ReturnType<typeof getWhatsappSettings>>, { ok: true }>;

export const formOfAddressLabels: Record<FormOfAddress, string> = {
  vos: "Vos",
  usted: "Usted",
};

export function CommunicationRulesSection({ settings }: { settings: Settings }) {
  const rules = settings.communicationRules;
  return (
    <RecordSection
      title="Reglas de comunicación"
      action={
        <Button variant="outline" nativeButton={false} render={<Link to="/whatsapp/reglas" />}>
          Editar
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          Cómo escribe el asistente a los pacientes. No cambian las plantillas, que Meta ya aprobó.
        </p>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Detail label="Trato" value={formOfAddressLabels[rules.formOfAddress]} />
          <Detail label="Firma" value={rules.signOff || null} />
          <Detail label="Versión" value={rules.version || null} />
        </dl>
        <dl>
          <Detail
            label="Tono"
            value={rules.tone ? <span className="whitespace-pre-line">{rules.tone}</span> : null}
          />
        </dl>
      </div>
    </RecordSection>
  );
}
