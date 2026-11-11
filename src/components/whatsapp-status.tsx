import { CheckCheckIcon, CheckIcon, CircleAlertIcon, ClockIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip.tsx";
import type { WhatsappMessageStatus } from "#/lib/whatsapp-messages.ts";

/** An outgoing message's status as a chat shows it: Meta's, or one not sent yet (queued, or a late reply waiting for the patient). */
export type ShownStatus = WhatsappMessageStatus | "queued" | "waiting";

const statusLabels: Record<ShownStatus, string> = {
  queued: "Pendiente",
  waiting: "En espera",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "No entregado",
};

const statusIcons: Record<ShownStatus, LucideIcon> = {
  queued: ClockIcon,
  waiting: ClockIcon,
  sent: CheckIcon,
  delivered: CheckCheckIcon,
  read: CheckCheckIcon,
  failed: CircleAlertIcon,
};

/**
 * A message's status as WhatsApp's ticks, in a `WhatsappBubble`'s footer:
 * named by its label for a screen reader, and in a tooltip.
 */
export function WhatsappStatus({ status }: { status: ShownStatus }) {
  const Icon = statusIcons[status];
  const label = statusLabels[status];
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span role="img" aria-label={label} tabIndex={0} className="inline-flex" />}
      >
        {/* Read in WhatsApp's blue; failed is the one to act on. */}
        <Icon
          aria-hidden
          className={cn(
            "size-4",
            status === "read" && "text-whatsapp-read",
            status === "failed" && "text-destructive",
          )}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
