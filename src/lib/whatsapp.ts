import * as z from "zod";

/**
 * The organization's WhatsApp number (`src/organization/whatsapp-connection.ts`):
 * connected, failed (Meta refused its token), or disconnected by an admin.
 */
export const connectionStates = ["connected", "failed", "disconnected"] as const;

export type ConnectionState = (typeof connectionStates)[number];

/** What Embedded Signup's popup returns, which the Worker completes the connection with. */
export const signupCompletionSchema = z.object({
  code: z.string().trim().min(1).max(2048),
  phoneNumberId: z.string().regex(/^\d{1,32}$/),
  businessAccountId: z.string().regex(/^\d{1,32}$/),
});

export type SignupCompletion = z.input<typeof signupCompletionSchema>;

/**
 * Meta's messaging limits, lowest first: how many people the number may start
 * conversations with a day, each as the settings and notifications name it.
 */
export const messagingLimitLabels: Record<string, string> = {
  TIER_50: "50 personas por día",
  TIER_250: "250 personas por día",
  TIER_2K: "2.000 personas por día",
  TIER_10K: "10.000 personas por día",
  TIER_100K: "100.000 personas por día",
  TIER_UNLIMITED: "Sin límite",
};

/** Whether `next` is a lower messaging limit than `previous`; a limit Meta gave none or an unknown one is neither. */
export function isLowerLimit(previous: string | null, next: string) {
  const order = Object.keys(messagingLimitLabels);
  const before = previous === null ? -1 : order.indexOf(previous);
  const after = order.indexOf(next);
  return before >= 0 && after >= 0 && after < before;
}

/**
 * Why the number cannot start conversations for now, which holds every
 * message underthing starts: Meta restricted it, disabled its account, or
 * refused a send for a rate limit.
 */
export const numberHoldReasons = ["restricted", "disabled", "rateLimited"] as const;

export type NumberHoldReason = (typeof numberHoldReasons)[number];
