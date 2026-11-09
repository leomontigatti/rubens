import { useEffect, useState } from "react";

import { useFormAction } from "#/components/admin-form.tsx";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { Detail, RecordSection } from "#/components/record-section.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import type { ConnectionState } from "#/lib/whatsapp.ts";
import { connectWhatsapp, disconnectWhatsapp } from "#/server/whatsapp.functions.ts";
import type { getWhatsappSettings } from "#/server/whatsapp.functions.ts";

import { loadFacebookSdk, runEmbeddedSignup } from "#/routes/_app/whatsapp/-embedded-signup.ts";

// The organization's number in the WhatsApp settings: connected through Meta's
// Embedded Signup, with its state and messaging limit, or the button to connect it.

type Settings = Extract<Awaited<ReturnType<typeof getWhatsappSettings>>, { ok: true }>;
type Connection = NonNullable<Settings["connection"]>;
type Signup = NonNullable<Settings["signup"]>;

const stateLabels: Record<ConnectionState, string> = {
  connected: "Conectado",
  failed: "Con error",
  disconnected: "Desconectado",
};

const stateVariants = {
  connected: "success",
  failed: "destructive",
  disconnected: "secondary",
} as const satisfies Record<ConnectionState, string>;

// Meta's tiers: how many people the number may start conversations with a day.
const limitLabels: Record<string, string> = {
  TIER_250: "250 personas por día",
  TIER_2K: "2.000 personas por día",
  TIER_10K: "10.000 personas por día",
  TIER_100K: "100.000 personas por día",
  TIER_UNLIMITED: "Sin límite",
};

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador puede usar la configuración de WhatsApp.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Meta no devolvió los datos del número. Probá de nuevo.",
  signupNotConfigured: "Falta la configuración del registro de Meta en el servidor.",
  numberNotInAccount: "El número no pertenece a la cuenta de WhatsApp Business elegida.",
  numberTaken: "Ese número ya está conectado a otra organización.",
  accountTaken: "Esa cuenta de WhatsApp Business ya está conectada a otra organización.",
  alreadyChanging: "Otro administrador está cambiando el número. Esperá y recargá la página.",
  notConnected: "No hay un número conectado.",
  metaRefused: "Meta rechazó la conexión.",
  signupFailed: "No se pudo completar el registro en Meta.",
};

type Reason = keyof typeof refusalMessages;

/** Runs Embedded Signup and completes it on the server; Meta's own words, when it gave some, replace the refusal's copy. */
function useConnect(signup: Signup | null, canConnect: boolean) {
  const action = useFormAction(refusalMessages);

  useEffect(() => {
    if (signup && canConnect) {
      // Loaded ahead, so the click opens the popup at once. A failure shows on the click.
      loadFacebookSdk(signup.appId).catch(() => undefined);
    }
  }, [signup, canConnect]);

  async function signUp(found: Signup) {
    const outcome = await runEmbeddedSignup(
      await loadFacebookSdk(found.appId),
      found.configurationId,
    );
    if (outcome.kind !== "completed") {
      return outcome.kind === "cancelled"
        ? ({ ok: true } as const)
        : ({ ok: false, reason: "signupFailed", metaMessage: outcome.message } as const);
    }
    const result = await connectWhatsapp({ data: outcome.completion });
    return result.ok || result.reason !== "metaRefused"
      ? result
      : ({ ok: false, reason: "metaRefused", metaMessage: result.metaError.message } as const);
  }

  async function connect() {
    if (!signup) {
      return;
    }
    let metaMessage: string | null = null;
    const done = await action.run(async () => {
      const result = await signUp(signup);
      metaMessage = "metaMessage" in result ? result.metaMessage : null;
      return result.ok ? result : { ok: false, reason: result.reason as Reason };
    });
    if (!done && metaMessage) {
      action.setError(metaMessage);
    }
  }

  return { action, connect };
}

export function NumberSection({ settings }: { settings: Settings }) {
  const { connection, signup } = settings;
  const connected = connection?.state === "connected";
  const { action, connect } = useConnect(signup, Boolean(signup) && !connected);
  const [confirming, setConfirming] = useState(false);

  return (
    <RecordSection
      title="Número de WhatsApp"
      action={
        connected ? (
          <Button variant="outline" disabled={action.pending} onClick={() => setConfirming(true)}>
            Desconectar
          </Button>
        ) : (
          <Button disabled={!signup || action.pending} onClick={() => void connect()}>
            {action.pending && <Spinner data-icon="inline-start" aria-hidden />}
            {connection ? "Conectar de nuevo" : "Conectar número"}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <ConnectionNotices connection={connection} canSignUp={Boolean(signup) || connected} />
        {action.error && (
          <Alert variant="destructive">
            <AlertTitle>No se pudo cambiar el número</AlertTitle>
            <AlertDescription>{action.error}</AlertDescription>
          </Alert>
        )}
        {connection && <ConnectionDetails connection={connection} />}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="¿Desconectar el número?"
        description="underthing deja de enviar y recibir mensajes de WhatsApp hasta que conectes un número de nuevo."
        confirmLabel="Desconectar"
        onConfirm={() => void action.run(() => disconnectWhatsapp())}
      />
    </RecordSection>
  );
}

/** What to do before a number is connected, and why one cannot be, or stopped working. */
function ConnectionNotices(props: { connection: Connection | null; canSignUp: boolean }) {
  const { connection } = props;
  return (
    <>
      {!connection && (
        <p className="text-muted-foreground text-sm">
          Conectá el número nuevo del consultorio desde Meta: ahí elegís o creás la cuenta de
          WhatsApp Business, agregás el número y la forma de pago, que Meta le cobra al consultorio.
        </p>
      )}
      {!props.canSignUp && (
        <Alert variant="warning">
          <AlertTitle>No se puede conectar un número</AlertTitle>
          <AlertDescription>{refusalMessages.signupNotConfigured}</AlertDescription>
        </Alert>
      )}
      {connection?.state === "failed" && (
        <Alert variant="destructive">
          <AlertTitle>Meta dejó de aceptar la conexión</AlertTitle>
          <AlertDescription>
            {connection.failureReason ?? "underthing no pudo usar la conexión guardada."} Conectá el
            número de nuevo para volver a enviar mensajes.
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

function ConnectionDetails({ connection }: { connection: Connection }) {
  const limit = connection.messagingLimit;
  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      <Detail label="Número" value={connection.displayNumber} />
      <Detail
        label="Estado"
        value={
          <Badge variant={stateVariants[connection.state]}>{stateLabels[connection.state]}</Badge>
        }
      />
      <Detail label="Límite de mensajes de Meta" value={limit && (limitLabels[limit] ?? limit)} />
    </dl>
  );
}
