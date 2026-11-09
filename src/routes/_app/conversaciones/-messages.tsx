import { Badge } from "#/components/ui/badge.tsx";
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
