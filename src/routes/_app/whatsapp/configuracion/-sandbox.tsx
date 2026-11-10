import { Link } from "@tanstack/react-router";

import { RecordSection } from "#/components/record-section.tsx";
import { Button } from "#/components/ui/button.tsx";

// The way into the assistant's sandbox from the WhatsApp settings (`prueba.tsx`).

export function SandboxSection() {
  return (
    <RecordSection
      title="Prueba del asistente"
      action={
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link to="/whatsapp/configuracion/prueba" />}
        >
          Probar
        </Button>
      }
    >
      <p className="text-muted-foreground text-sm">
        Escribí como un paciente desde el recordatorio de un turno y mirá qué responde el asistente,
        qué herramientas usa y qué retendría el control clínico. Nada se guarda ni se envía.
      </p>
    </RecordSection>
  );
}
