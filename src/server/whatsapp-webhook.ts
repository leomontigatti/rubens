import * as z from "zod";

import { whatsappMessageStatuses } from "#/lib/whatsapp-messages.ts";
import type {
  IncomingWhatsappMessage,
  WhatsappEvents,
  WhatsappStatusUpdate,
  WhatsappTemplateStatusUpdate,
} from "#/lib/whatsapp-messages.ts";
import { templateStatusOf as templateStatus } from "#/lib/whatsapp-templates.ts";

import { organizationObject } from "#/server/caller.ts";
import type { WorkerEnv } from "#/server/caller.ts";
import { sameSecret } from "#/server/same-secret.ts";
import { whatsappDirectoryName } from "#/server/whatsapp-directory.ts";
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

type MetaPayload = z.infer<typeof metaWebhook>;

/** A `message_template_status_update` change's status, or none for an event underthing does not store (such as `FLAGGED`). */
function templateStatusOf(value: unknown): WhatsappTemplateStatusUpdate | null {
  const parsed = metaTemplateStatus.safeParse(value);
  const status = parsed.success ? templateStatus(parsed.data.event) : null;
  if (!parsed.success || !status) {
    return null;
  }
  const reason = parsed.data.reason && parsed.data.reason !== "NONE" ? parsed.data.reason : null;
  return { metaId: parsed.data.message_template_id, status, reason };
}

/**
 * Finds whose object an event goes to: the Worker's configured test number
 * and its account first (kept for development), then the WhatsApp directory
 * (ADR-0012), which maps each connected number and its account. Each id is
 * looked up once per call.
 */
function organizationFinder(env: WorkerEnv) {
  const directory = env.WHATSAPP_DIRECTORY.get(
    env.WHATSAPP_DIRECTORY.idFromName(whatsappDirectoryName),
  );
  const configured = env.WHATSAPP_ORGANIZATION_ID;
  const found = new Map<string, Promise<string | null>>();
  function memo(key: string, find: () => Promise<string | null>) {
    let organizationId = found.get(key);
    if (!organizationId) {
      organizationId = find();
      found.set(key, organizationId);
    }
    return organizationId;
  }
  return {
    forNumber: (phoneNumberId: string) =>
      memo(`number:${phoneNumberId}`, async () =>
        configured && phoneNumberId === env.WHATSAPP_PHONE_NUMBER_ID
          ? configured
          : directory.organizationForNumber(phoneNumberId),
      ),
    forAccount: (accountId: string) =>
      memo(`account:${accountId}`, async () =>
        configured && accountId === env.WHATSAPP_BUSINESS_ACCOUNT_ID
          ? configured
          : directory.organizationForAccount(accountId),
      ),
  };
}

type MetaChange = z.infer<typeof metaChange>;

/** A `messages` change's messages and statuses. A status underthing does not store (such as `deleted`) is skipped. */
function messageEventsOf(value: MetaChange["value"]): WhatsappEvents {
  return {
    messages: (value.messages ?? []).map(incomingOf),
    statuses: (value.statuses ?? []).flatMap(({ id, status, timestamp }) =>
      isKnownStatus(status) ? [{ whatsappId: id, status, at: timestamp * 1000 }] : [],
    ),
    templateStatuses: [],
  };
}

/**
 * A change's events, with the lookup of whose they are, run when the call's
 * changes are read one by one: the number's
 * organization for a `messages` change, the account's for a template's
 * status. `null` for a change underthing does not store.
 */
function routeOf(
  find: ReturnType<typeof organizationFinder>,
  accountId: string | undefined,
  change: MetaChange,
) {
  if (change.field === "messages") {
    const phoneNumberId = change.value.metadata?.phone_number_id;
    const lookup = async () => (phoneNumberId ? find.forNumber(phoneNumberId) : null);
    return { lookup, events: messageEventsOf(change.value) };
  }
  const status =
    change.field === "message_template_status_update" ? templateStatusOf(change.value) : null;
  if (!status) {
    return null;
  }
  const lookup = async () => (accountId ? find.forAccount(accountId) : null);
  return { lookup, events: { messages: [], statuses: [], templateStatuses: [status] } };
}

/** Adds `events` to the organization's events of the call. */
function addEvents(
  all: Map<string, WhatsappEvents>,
  organizationId: string,
  events: WhatsappEvents,
) {
  const ours = all.get(organizationId);
  if (!ours) {
    all.set(organizationId, events);
    return;
  }
  ours.messages.push(...events.messages);
  ours.statuses.push(...events.statuses);
  ours.templateStatuses.push(...events.templateStatuses);
}

/**
 * The events of a call, by the organization each is for, and how many
 * changes were for a number or an account no organization has.
 */
async function eventsByOrganization(payload: MetaPayload, env: WorkerEnv) {
  const find = organizationFinder(env);
  const routes = payload.entry.flatMap((entry) =>
    entry.changes.map((change) => routeOf(find, entry.id, change)),
  );
  const events = new Map<string, WhatsappEvents>();
  let unknown = 0;
  for (const route of routes) {
    const organizationId = route && (await route.lookup());
    if (organizationId) {
      addEvents(events, organizationId, route.events);
    } else if (route) {
      unknown += 1;
    }
  }
  return { events, unknown };
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
  const { events, unknown } = await eventsByOrganization(parsed.data, env);
  if (unknown > 0) {
    console.warn(
      `[whatsapp-webhook] dropped ${unknown} change(s) for a number or account no organization has`,
    );
  }
  let stored = true;
  for (const [organizationId, organizationEvents] of events) {
    const { messages, statuses, templateStatuses } = organizationEvents;
    if (messages.length + statuses.length + templateStatuses.length === 0) {
      continue;
    }
    const result = await organizationObject(env, organizationId).storeWhatsappEvents(
      organizationEvents,
    );
    if (!result.ok) {
      // A mapping to an object no organization was set up in: Meta retries
      // the call, for up to 7 days, while the mapping is corrected.
      console.error(`[whatsapp-webhook] organization ${organizationId} is not set up`);
      stored = false;
    }
  }
  if (!stored) {
    return new Response(null, { status: 500 });
  }
  return new Response(null, { status: 200 });
}
