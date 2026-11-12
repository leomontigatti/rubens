import { Link } from "@tanstack/react-router";

import { Detail, RecordSection } from "#/components/record-section.tsx";
import { Button } from "#/components/ui/button.tsx";
import type { getWhatsappSettings } from "#/server/whatsapp.functions.ts";

// The handoff reminders in the WhatsApp settings: how many hours before the
// conversation window closes a handoff's recipients are reminded of it, and
// every other member who may answer it too, edited on their own page.

type Settings = Extract<Awaited<ReturnType<typeof getWhatsappSettings>>, { ok: true }>;

export const handoffRemindersHint =
  "Cuántas horas antes del cierre de la ventana se recuerda una derivación sin respuesta. De 21 a 8, espera a las 8.";

function hoursBeforeText(hours: number) {
  return hours === 1 ? "1 hora antes del cierre" : `${hours} horas antes del cierre`;
}

export function HandoffRemindersSection({ settings }: { settings: Settings }) {
  const { recipientHours, othersHours } = settings.handoffReminders;
  return (
    <RecordSection
      title="Recordatorios de derivaciones"
      action={
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link to="/whatsapp/configuracion/recordatorios" />}
        >
          Editar
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">{handoffRemindersHint}</p>
        <dl>
          <Detail label="A quien la recibe" value={hoursBeforeText(recipientHours)} />
          <Detail label="A los demás" value={hoursBeforeText(othersHours)} />
        </dl>
      </div>
    </RecordSection>
  );
}
