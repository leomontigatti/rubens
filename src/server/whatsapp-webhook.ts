import * as z from "zod";

import { whatsappMessageStatuses } from "#/lib/whatsapp-messages.ts";
import type {
  IncomingWhatsappMessage,
  WhatsappEvents,
  WhatsappStatusUpdate,
} from "#/lib/whatsapp-messages.ts";

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

const metaWebhook = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(z.object({ changes: z.array(metaChange) })),
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
 * The `messages` changes of a call for `phoneNumberId`, the one number this
 * Worker serves until Embedded Signup (#159), and how many changes were for
 * another number. A status Rubens does not store (such as `deleted`) is skipped.
 */
function eventsFor(
  payload: z.infer<typeof metaWebhook>,
  phoneNumberId: string | undefined,
): { events: WhatsappEvents; otherNumbers: number } {
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
    json = JSON.parse(new TextDecoder().decode(body));
  } catch {
    json = undefined;
  }
  const parsed = metaWebhook.safeParse(json);
  if (!parsed.success) {
    // The issues can quote the payload, so they are not logged.
    console.warn("[whatsapp-webhook] a signed call in a shape Rubens does not read was dropped");
    return new Response(null, { status: 200 });
  }
  const organizationId = env.WHATSAPP_ORGANIZATION_ID;
  // A number with no organization to store it in is served by no one.
  const servedNumber = organizationId ? env.WHATSAPP_PHONE_NUMBER_ID : undefined;
  const { events, otherNumbers } = eventsFor(parsed.data, servedNumber);
  if (otherNumbers > 0) {
    console.warn(
      `[whatsapp-webhook] dropped ${otherNumbers} change(s) for a phone number id no organization has`,
    );
  }
  if (organizationId && events.messages.length + events.statuses.length > 0) {
    await organizationObject(env, organizationId).storeWhatsappEvents(events);
  }
  return new Response(null, { status: 200 });
}
