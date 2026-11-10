import { Detail, RecordSection } from "#/components/record-section.tsx";
import { transcriptionLine, usageLine, usageMonthName } from "#/lib/assistant-usage.ts";
import type { getWhatsappSettings } from "#/server/whatsapp.functions.ts";

// What the assistant used this month in the WhatsApp settings
// (docs/domain/assistant.md § Costs): the model's tokens and the voice notes'
// audio transcribed, the sandbox's apart.

type Settings = Extract<Awaited<ReturnType<typeof getWhatsappSettings>>, { ok: true }>;

export function UsageSection({ settings }: { settings: Settings }) {
  const { month, models, transcriptions } = settings.usage;
  return (
    <RecordSection title="Uso del asistente">
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          Los tokens que usó el modelo del asistente y el audio de las notas de voz que transcribió
          en {usageMonthName(month)}, en las conversaciones con pacientes y en la prueba. Meta le
          cobra los mensajes de WhatsApp al consultorio directamente.
        </p>
        {models.length === 0 && transcriptions.length === 0 ? (
          <p className="text-sm">Todavía no hay uso este mes.</p>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2">
            {models.map((used) => (
              <Detail key={`${used.model}-${used.sandbox}`} {...usageLine(used)} />
            ))}
            {transcriptions.map((heard) => (
              <Detail key={`${heard.model}-${heard.sandbox}`} {...transcriptionLine(heard)} />
            ))}
          </dl>
        )}
      </div>
    </RecordSection>
  );
}
