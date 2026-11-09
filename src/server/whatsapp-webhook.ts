import * as z from "zod";

import { whatsappMessageStatuses } from "#/lib/whatsapp-messages.ts";
import type {
  IncomingWhatsappMessage,
  WhatsappEvents,
  WhatsappStatusUpdate,
  WhatsappTemplateStatusUpdate,
} from "#/lib/whatsapp-messages.ts";
import { templateStatusOf } from "#/lib/whatsapp-templates.ts";

import { organizationObject } from "#/server/caller.ts";
import type { WorkerEnv } from "#/server/caller.ts";
import { sameSecret } from "#/server/same-secret.ts";
import { isSignedByMeta } from "#/server/whatsapp-signature.ts";

// Meta's WhatsApp webhook (ADR-0010 § The webhook stores, the object's alarm
// acts), outside the staff sign-in: Meta's signature is what lets a call in.
// The Worker stores each call's events in the organization's object and
// answers at once; nothing here acts on a message or calls a model. A
// patient's message text is never logged.
//
// Meta's payload is read in Meta's own vocabulary
// (https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components),
// and only the fields stored: the rest of a message is kept as it came.

const metaMessage = z.looseObject({
  /** The sender's WhatsApp id: their number in digits, without the `+`. */
  from: z.string().regex(/^\d+$/),
  id: z.string().min(1),
  /** Unix seconds, as a string. */
  timestamp: z.coerce.number().int(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
});

const metaStatus = z.looseObject({
  id: z.string().min(1),
  status: z.string(),
  timestamp: z.coerce.number().int(),
});

const metaChange = z.object({
  field: z.string(),
  value: z.looseObject({
    metadata: z.object({ phone_number_id: z.string() }).optional(),
    messages: z.array(metaMessage).optional(),
    statuses: z.array(metaStatus).optional(),
  }),
});

/** A `message_template_status_update` change's value. */
const metaTemplateStatus = z.looseObject({
  event: z.string(),
  message_template_id: z.string().regex(/^\d+$/),
  reason: z.string().nullish(),
});

const metaWebhook = z.object({
  object: z.literal("whatsapp_business_account"),
  // The entry's id is the WhatsApp Business account's.
  entry: z.array(z.object({ id: z.string().optional(), changes: z.array(metaChange) })),
});

type MetaMessage = z.infer<typeof metaMessage>;

function incomingOf(message: MetaMessage): IncomingWhatsappMessage {
  return {
    whatsappId: message.id,
    from: `+${message.from}`,
    sentAt: message.timestamp * 1000,
    type: message.type,
    text: message.text?.body ?? null,
    payload: JSON.stringify(message),
  };
}

function isKnownStatus(status: string): status is WhatsappStatusUpdate["status"] {
  return (whatsappMessageStatuses as readonly string[]).includes(status);
}

/**
 * The template status changes of a call for `accountId`, the one WhatsApp
 * Business account this Worker serves until Embedded Signup (#159). An event
 * with no status underthing stores (such as `FLAGGED`) is skipped; a refresh
 * from the settings reads the status it leads to.
 */
function templateStatusesFor(
  payload: z.infer<typeof metaWebhook>,
  accountId: string | undefined,
): WhatsappTemplateStatusUpdate[] {
  return payload.entry
    .filter((entry) => accountId && entry.id === accountId)
    .flatMap((entry) => entry.changes)
    .filter((change) => change.field === "message_template_status_update")
    .flatMap((change) => {
      const value = metaTemplateStatus.safeParse(change.value);
      const status = value.success ? templateStatusOf(value.data.event) : null;
      if (!value.success || !status) {
        return [];
      }
      const reason = value.data.reason && value.data.reason !== "NONE" ? value.data.reason : null;
      return [{ metaId: value.data.message_template_id, status, reason }];
    });
}

/**
 * The `messages` changes of a call for `phoneNumberId`, the one number this
 * Worker serves until Embedded Signup (#159), and how many changes were for
 * another number. A status underthing does not store (such as `deleted`) is skipped.
 */
function messageEventsFor(
  payload: z.infer<typeof metaWebhook>,
  phoneNumberId: string | undefined,
): { events: Omit<WhatsappEvents, "templateStatuses">; otherNumbers: number } {
  const changes = payload.entry
    .flatMap((entry) => entry.changes)
    .filter((change) => change.field === "messages");
  const ours = changes
    .map((change) => change.value)
    .filter((value) => phoneNumberId && value.metadata?.phone_number_id === phoneNumberId);
  const statuses = ours.flatMap((value) => value.statuses ?? []);
  return {
    events: {
      messages: ours.flatMap((value) => (value.messages ?? []).map(incomingOf)),
      statuses: statuses.flatMap(({ id, status, timestamp }) =>
        isKnownStatus(status) ? [{ whatsappId: id, status, at: timestamp * 1000 }] : [],
      ),
    },
    otherNumbers: changes.length - ours.length,
  };
}

/**
 * Reads a template's id as the digits Meta sent: Meta sends it as a JSON
 * number, which can be past JavaScript's safe integers.
 */
function keepTemplateIdDigits(key: string, value: unknown, context?: { source?: string }) {
  return key === "message_template_id" && typeof value === "number" && context?.source
    ? context.source
    : value;
}

/** Meta's `GET` when the webhook is set up: the challenge back, for the right verify token. */
async function answerHandshake(url: URL, verifyToken: string): Promise<Response> {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (mode !== "subscribe" || !(await sameSecret(token, verifyToken))) {
    return new Response(null, { status: 403 });
  }
  return new Response(challenge, { headers: { "content-type": "text/plain" } });
}

/**
 * Serves `/api/whatsapp`. A call that is not Meta's is refused before it
 * reaches any object; a call Meta signed is answered 200 even when nothing in
 * it is stored, so Meta does not repeat it.
 */
export async function handleWhatsappWebhook(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method === "GET") {
    return env.WHATSAPP_VERIFY_TOKEN
      ? answerHandshake(new URL(request.url), env.WHATSAPP_VERIFY_TOKEN)
      : new Response(null, { status: 404 });
  }
  if (!env.META_APP_SECRET) {
    return new Response(null, { status: 404 });
  }
  const body = new Uint8Array(await request.arrayBuffer());
  const signature = request.headers.get("x-hub-signature-256");
  if (!(await isSignedByMeta(body, signature, env.META_APP_SECRET))) {
    return new Response(null, { status: 401 });
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(body), keepTemplateIdDigits);
  } catch {
    json = undefined;
  }
  const parsed = metaWebhook.safeParse(json);
  if (!parsed.success) {
    // The issues can quote the payload, so they are not logged.
    console.warn(
      "[whatsapp-webhook] a signed call in a shape underthing does not read was dropped",
    );
    return new Response(null, { status: 200 });
  }
  const organizationId = env.WHATSAPP_ORGANIZATION_ID;
  // A number with no organization to store it in is served by no one.
  const servedNumber = organizationId ? env.WHATSAPP_PHONE_NUMBER_ID : undefined;
  const { events: messageEvents, otherNumbers } = messageEventsFor(parsed.data, servedNumber);
  if (otherNumbers > 0) {
    console.warn(
      `[whatsapp-webhook] dropped ${otherNumbers} change(s) for a phone number id no organization has`,
    );
  }
  const servedAccount = organizationId ? env.WHATSAPP_BUSINESS_ACCOUNT_ID : undefined;
  const events = {
    ...messageEvents,
    templateStatuses: templateStatusesFor(parsed.data, servedAccount),
  };
  const count = events.messages.length + events.statuses.length + events.templateStatuses.length;
  if (organizationId && count > 0) {
    await organizationObject(env, organizationId).storeWhatsappEvents(events);
  }
  return new Response(null, { status: 200 });
}
