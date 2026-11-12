import { ExternalLinkIcon } from "lucide-react";

import { Detail, RecordSection } from "#/components/record-section.tsx";
import { Button } from "#/components/ui/button.tsx";
import { whatsappManagerCostsUrl } from "#/lib/whatsapp.ts";
import type { getWhatsappSettings } from "#/server/whatsapp.functions.ts";

// The month's WhatsApp messages Meta bills the organization for (#294), in
// the WhatsApp settings: counts only, since Meta bills the organization
// directly and its prices change (`src/organization/month-messages.ts`).

type Settings = Extract<Awaited<ReturnType<typeof getWhatsappSettings>>, { ok: true }>;

const counted = (count: number) => count.toLocaleString("es-AR");

export function MessagesSection({ settings }: { settings: Settings }) {
  const { templates, serviceMessages } = settings.messages;
  const none =
    serviceMessages + templates.utility + templates.marketing + templates.authentication === 0;
  const accountId = settings.businessAccountId;
  return (
    <RecordSection
      title="Mensajes de WhatsApp este mes"
      action={
        accountId && (
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <a href={whatsappManagerCostsUrl(accountId)} target="_blank" rel="noreferrer" />
            }
          >
            Ver costos en Meta
            <ExternalLinkIcon data-icon="inline-end" />
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          Meta se los cobra a la organización, solo los que entregó.
        </p>
        {none ? (
          <p className="text-sm">Todavía no hay mensajes este mes.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Detail label="Plantillas de utilidad" value={counted(templates.utility)} />
            <Detail label="Plantillas de marketing" value={counted(templates.marketing)} />
            <Detail label="Plantillas de autenticación" value={counted(templates.authentication)} />
            <Detail
              label="Mensajes de servicio"
              value={
                <span className="flex flex-col gap-1">
                  {counted(serviceMessages)}
                  <span className="text-muted-foreground text-sm">
                    Los primeros 1.000 del mes no se cobran.
                  </span>
                </span>
              }
            />
          </dl>
        )}
      </div>
    </RecordSection>
  );
}
