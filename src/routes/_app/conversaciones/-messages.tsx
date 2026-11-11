import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { serverAnswer, shownPath } from "#/components/save-failure.ts";
import { toast } from "#/components/ui/toast.tsx";
import { WhatsappStatus } from "#/components/whatsapp-status.tsx";
import type { InboxMessage } from "#/organization/inbox.ts";

export const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo el personal puede leer las conversaciones.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "No encontramos esa conversación.",
  notFound: "No encontramos esa conversación, o no es sobre tus turnos.",
};

/** An outgoing message's delivery, as its icon; none for the patient's, or a message the reader may not read. */
export function MessageStatus({ message }: { message: InboxMessage }) {
  if (message.withheld !== null || message.status === null) {
    return null;
  }
  return <WhatsappStatus status={message.status} />;
}

/**
 * Runs one of the inbox's calls, then reloads the page; a refusal is a toast
 * with its line in `refusals`, since no form holds it. Says whether it went.
 */
export function useInboxAction<Refusal extends string>(refusals: Record<Refusal, string>) {
  const router = useRouter();
  const [running, setRunning] = useState(false);

  async function run(
    tag: string,
    call: () => Promise<{ ok: true } | { ok: false; reason: Refusal }>,
  ) {
    setRunning(true);
    try {
      const result = await serverAnswer(tag, shownPath(router), call);
      if (result?.ok) {
        await router.invalidate();
      } else if (result) {
        toast.add({ title: refusals[result.reason], type: "destructive" });
      }
      return result?.ok === true;
    } finally {
      setRunning(false);
    }
  }

  return { running, run };
}
