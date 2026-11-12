import { Link } from "@tanstack/react-router";

import { RecordSection } from "#/components/record-section.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import type { getWhatsappSettings } from "#/server/whatsapp.functions.ts";

// The handoff contacts in the WhatsApp settings: the members who receive the
// handoffs that concern no particular practitioner, picked on their own page.

type Settings = Extract<Awaited<ReturnType<typeof getWhatsappSettings>>, { ok: true }>;

export const handoffContactsHint = "Quiénes reciben las derivaciones que no son de un turno.";

export const keepsRecordsLabel = "Lleva historias clínicas";

export function HandoffContactsSection({ settings }: { settings: Settings }) {
  const contacts = settings.handoffContacts.filter((one) => one.handoffContact);
  return (
    <RecordSection
      title="Contactos de derivación"
      action={
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link to="/whatsapp/configuracion/contactos" />}
        >
          {contacts.length ? "Editar" : "Elegir"}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">{handoffContactsHint}</p>
        {contacts.length ? (
          <ul className="flex flex-col gap-2">
            {contacts.map((one) => (
              <li key={one.memberId} className="flex flex-wrap items-center gap-2">
                {one.name}
                {one.keepsClinicalRecords && <Badge variant="secondary">{keepsRecordsLabel}</Badge>}
              </li>
            ))}
          </ul>
        ) : (
          <Alert variant="warning">
            <AlertTitle>Todavía no hay contactos de derivación</AlertTitle>
            {/* Who gets them meanwhile (`contactsFor` in `src/organization/handoffs.ts`). */}
            <AlertDescription>
              Mientras no elijas, las derivaciones van a los administradores, y las clínicas a los
              profesionales que llevan historias clínicas.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </RecordSection>
  );
}
