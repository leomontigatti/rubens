import { Link } from "@tanstack/react-router";
import { MessagesSquareIcon } from "lucide-react";

import { useFormAction } from "#/components/admin-form.tsx";
import { patientRefusalMessages } from "#/components/patient-save.ts";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Button } from "#/components/ui/button.tsx";
import { DropdownMenuItem } from "#/components/ui/dropdown-menu.tsx";
import { formatDateTime } from "#/lib/dates.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { changeWhatsappConsent } from "#/server/patients.functions.ts";
import type { Patient } from "#/organization/patients.ts";

// A patient's WhatsApp, on their page: sending to them is the regular state,
// so only its exceptions show, as an alert above the form (one that no longer
// receives, one whose reply looks like an opt-out); `Acciones` turns it off
// and back on.

/**
 * Turning the patient's WhatsApp off or back on. Its `action` is the one
 * `Acciones` runs the archive with too, so the header shows the latest refusal.
 */
export function useWhatsappConsent(patientId: string) {
  const action = useFormAction(patientRefusalMessages);
  return {
    action,
    pending: action.pending,
    set: (whatsappConsent: boolean) =>
      void action.run(() => changeWhatsappConsent({ data: { patientId, whatsappConsent } })),
  };
}

type WhatsappConsent = ReturnType<typeof useWhatsappConsent>;

/** `Acciones`' item: `Dejar de enviar por WhatsApp`, or, once off, `Volver a enviar por WhatsApp`. */
export function WhatsappMenuItem(props: { patient: Patient; consent: WhatsappConsent }) {
  const { whatsappConsent } = props.patient;
  return (
    <DropdownMenuItem
      disabled={props.consent.pending}
      onClick={() => props.consent.set(!whatsappConsent)}
    >
      {whatsappConsent ? "Dejar de enviar por WhatsApp" : "Volver a enviar por WhatsApp"}
    </DropdownMenuItem>
  );
}

/**
 * The patient's WhatsApp when it is not the regular state: off, as an `info`
 * alert like an archived record's, with `Volver a enviar`; or held by a reply
 * that looks like an opt-out, a `warning` until someone decides.
 */
export function WhatsappAlert(props: {
  patient: Patient;
  optOutPendingSince: number | null;
  consent: WhatsappConsent;
}) {
  const { consent } = props;
  if (!props.patient.whatsappConsent) {
    return (
      <Alert variant="info">
        <AlertTitle>No recibe mensajes por WhatsApp</AlertTitle>
        <AlertDescription>No se le envían recordatorios ni avisos de sus turnos.</AlertDescription>
        <AlertAction>
          <Button
            size="sm"
            variant="link"
            disabled={consent.pending}
            onClick={() => consent.set(true)}
          >
            Volver a enviar
          </Button>
        </AlertAction>
      </Alert>
    );
  }
  if (props.optOutPendingSince === null) {
    return null;
  }
  return (
    <Alert variant="warning">
      <AlertTitle>Pidió no recibir más mensajes</AlertTitle>
      <AlertDescription>
        {`El ${formatDateTime(props.optOutPendingSince, defaultTimeZone)} su número respondió algo que parece un pedido de baja. Sus recordatorios y avisos quedan en espera hasta que decidas.`}
      </AlertDescription>
      <AlertAction>
        <Button
          size="sm"
          variant="link"
          disabled={consent.pending}
          onClick={() => consent.set(false)}
        >
          Dejar de enviar
        </Button>
        <Button
          size="sm"
          variant="link"
          disabled={consent.pending}
          onClick={() => consent.set(true)}
        >
          Seguir enviando
        </Button>
      </AlertAction>
    </Alert>
  );
}

/** After the phone's number: the conversation with the number the patient's messages go to. */
export function ConversationButton(props: { conversationId: string }) {
  return (
    <Button
      variant="outline"
      nativeButton={false}
      render={
        <Link
          to="/conversaciones/$conversationId"
          params={{ conversationId: props.conversationId }}
        />
      }
    >
      <MessagesSquareIcon data-icon="inline-start" aria-hidden />
      Ver conversación
    </Button>
  );
}
