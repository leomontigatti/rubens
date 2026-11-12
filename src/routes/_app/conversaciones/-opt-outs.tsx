import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "#/components/ui/button.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { formatDateTime } from "#/lib/dates.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import type { ShownOptOut } from "#/organization/opt-out-holds.ts";
import { submitOptOutDecision } from "#/server/patients.functions.ts";

import { useInboxAction } from "#/routes/_app/conversaciones/-messages.tsx";

// An opt-out decided where it was said (docs/domain/patients.md § WhatsApp
// consent): under the patient's reply that looked like one, a row for each
// patient it held, with turning their WhatsApp consent off or keeping it, for
// whoever reads the conversation, since every reader may change consent. Once
// decided, here or on the patient's record, the row is a muted line saying who
// decided what, and when.

const refusals = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "No podés cambiar el WhatsApp de los pacientes.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "No encontramos ese pedido de baja. Recargá la página.",
  notFound: "No encontramos al paciente. Recargá la página.",
  decided: "Otra persona ya lo decidió.",
};

/** The opt-out's rows under the patient's message: the held patients' to decide, then the decided lines. */
export function OptOutRows({ optOuts }: { optOuts: ShownOptOut[] }) {
  const router = useRouter();
  const action = useInboxAction(refusals);
  // The button saving, which shows the spinner while every button waits.
  const [saving, setSaving] = useState<string | null>(null);
  const pending = optOuts.filter((one) => one.decision === null);

  async function decide(one: ShownOptOut, whatsappConsent: boolean) {
    const data = { messageId: one.messageId, patientId: one.patient.id, whatsappConsent };
    setSaving(`${one.patient.id}-${whatsappConsent}`);
    try {
      // A decision someone else made shows once the page reloads.
      if (!(await action.run("decide-opt-out", () => submitOptOutDecision({ data })))) {
        await router.invalidate();
      }
    } finally {
      setSaving(null);
    }
  }

  const button = (one: ShownOptOut, keep: boolean, label: string) => (
    <DecisionButton
      saving={saving === `${one.patient.id}-${keep}`}
      // Until the page has reloaded after a refusal too.
      disabled={saving !== null}
      onClick={() => void decide(one, keep)}
    >
      {label}
    </DecisionButton>
  );

  return (
    <>
      {pending.length > 0 && (
        <div className="bg-card flex w-full max-w-md flex-col gap-2 rounded-lg border px-3 py-2 text-sm">
          <p className="text-muted-foreground text-xs">
            Parece un pedido de baja. Sus recordatorios y avisos esperan hasta que decidas.
          </p>
          {pending.map((one) => (
            <div key={one.patient.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 basis-40 font-medium">{one.patient.name}</span>
              {/* The two wrap together, under the name when the row is narrow. */}
              <div className="flex gap-2">
                {button(one, false, "Dejar de enviar")}
                {button(one, true, "Seguir enviando")}
              </div>
            </div>
          ))}
        </div>
      )}
      {optOuts.map(
        (one) =>
          one.decision && (
            <p key={one.patient.id} className="text-muted-foreground text-xs">
              {`${one.decision.by} decidió ${one.decision.kept ? "seguir enviando" : "dejar de enviar"} a ${one.patient.name} · ${formatDateTime(one.decision.at, defaultTimeZone)}`}
            </p>
          ),
      )}
    </>
  );
}

/** One of the two decisions, with the spinner while it saves. */
function DecisionButton(props: {
  saving: boolean;
  disabled: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <Button variant="outline" size="sm" disabled={props.disabled} onClick={props.onClick}>
      {props.saving && <Spinner data-icon="inline-start" aria-hidden />}
      {props.children}
    </Button>
  );
}
