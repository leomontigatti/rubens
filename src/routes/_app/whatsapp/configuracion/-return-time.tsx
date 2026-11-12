import { Link } from "@tanstack/react-router";

import { Detail, RecordSection } from "#/components/record-section.tsx";
import { Button } from "#/components/ui/button.tsx";
import type { getWhatsappSettings } from "#/server/whatsapp.functions.ts";

// The return time in the WhatsApp settings: how long a member holds a
// conversation they took over from the inbox before it goes back to the
// assistant, edited on its own page.

type Settings = Extract<Awaited<ReturnType<typeof getWhatsappSettings>>, { ok: true }>;

export const returnTimeHint =
  "Cuánto después de que alguien toma una conversación, o de su última respuesta, vuelve a responder el asistente.";

function hoursText(hours: number) {
  return hours === 1 ? "1 hora" : `${hours} horas`;
}

export function ReturnTimeSection({ settings }: { settings: Settings }) {
  return (
    <RecordSection
      title="Devolución al asistente"
      action={
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link to="/whatsapp/configuracion/devolucion" />}
        >
          Editar
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">{returnTimeHint}</p>
        <dl>
          <Detail
            label="Vuelve al asistente después de"
            value={hoursText(settings.returnAfterHours)}
          />
        </dl>
      </div>
    </RecordSection>
  );
}
