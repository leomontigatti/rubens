import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { serverAnswer, shownPath } from "#/components/save-failure.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { toast } from "#/components/ui/toast.tsx";
import type { InboxMessage } from "#/organization/inbox.ts";

import { statusLabels } from "#/routes/_app/conversaciones/-labels.ts";

export const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo el personal puede leer las conversaciones.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "No encontramos esa conversación.",
  notFound: "No encontramos esa conversación, o no es sobre tus turnos.",
};

/** An outgoing message's delivery, as a badge; failed is the one to act on. */
export function StatusBadge({ message }: { message: InboxMessage }) {
  if (message.withheld !== null || message.status === null) {
    return null;
  }
  return (
    <Badge variant={message.status === "failed" ? "destructive" : "secondary"}>
      {statusLabels[message.status]}
    </Badge>
  );
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
