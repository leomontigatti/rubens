import { Detail, RecordSection } from "#/components/record-section.tsx";
import { usageLine, usageMonthName } from "#/lib/assistant-usage.ts";
import type { getWhatsappSettings } from "#/server/whatsapp.functions.ts";

// What the assistant used this month in the WhatsApp settings
// (docs/domain/assistant.md § Costs): the model's tokens, the sandbox's apart.

type Settings = Extract<Awaited<ReturnType<typeof getWhatsappSettings>>, { ok: true }>;

export function UsageSection({ settings }: { settings: Settings }) {
  const { month, models } = settings.usage;
  return (
    <RecordSection title="Uso del asistente">
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          Los tokens que usó el modelo del asistente en {usageMonthName(month)}, en las
          conversaciones con pacientes y en la prueba. Meta le cobra los mensajes de WhatsApp al
          consultorio directamente.
        </p>
        {models.length === 0 ? (
          <p className="text-sm">Todavía no hay uso este mes.</p>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2">
            {models.map((used) => (
              <Detail key={`${used.model}-${used.sandbox}`} {...usageLine(used)} />
            ))}
          </dl>
        )}
      </div>
    </RecordSection>
  );
}
