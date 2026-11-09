import * as z from "zod";

import { whatsappMessageStatuses } from "#/lib/whatsapp-messages.ts";
import type {
  IncomingWhatsappMessage,
  WhatsappEvents,
  WhatsappNumberEvent,
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

/** A `template_category_update` change's value: a move done, or, with no `previous_category`, one still to come. */
const metaCategoryUpdate = z.looseObject({
  message_template_id: z.string().regex(/^\d+$/),
  previous_category: z.string().optional(),
  new_category: z.string(),
});

/** An `account_update` change's value, for the events that limit the number. */
const metaAccountUpdate = z.looseObject({
  event: z.string(),
  restriction_info: z
    .array(
      z.looseObject({
        restriction_type: z.string(),
        /** Unix seconds. */
        expiration: z.coerce.number().int().optional(),
      }),
    )
    .optional(),
  ban_info: z.looseObject({ waba_ban_state: z.string() }).optional(),
});

/** A `phone_number_quality_update` change's value: the limit, under its newer name first. */
const metaQualityUpdate = z.looseObject({
  current_limit: z.string().optional(),
  max_daily_conversations_per_business: z.string().optional(),
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

const noEvents = (): WhatsappEvents => ({ messages: [], statuses: [], templateStatuses: [] });

/** A `messages` change's messages and statuses. A status underthing does not store (such as `deleted`) is skipped. */
function messageEventsOf(value: MetaChange["value"]): WhatsappEvents {
  return {
    ...noEvents(),
    messages: (value.messages ?? []).map(incomingOf),
    statuses: (value.statuses ?? []).flatMap(({ id, status, timestamp }) =>
      isKnownStatus(status) ? [{ whatsappId: id, status, at: timestamp * 1000 }] : [],
    ),
  };
}

/** A completed move of a template to another category; a warning of one to come is not stored. */
function templateCategoryOf(value: unknown): WhatsappEvents | null {
  const parsed = metaCategoryUpdate.safeParse(value);
  if (!parsed.success || !parsed.data.previous_category) {
    return null;
  }
  const { message_template_id: metaId, new_category: category } = parsed.data;
  return { ...noEvents(), templateCategories: [{ metaId, category }] };
}

/**
 * The account's restriction of business-started messages, which holds every
 * template underthing sends, until its latest expiration (or until lifted,
 * when one has none); a restriction without it lifts the hold. A ban, until
 * Meta reinstates the account.
 */
function accountEventOf(value: unknown): WhatsappNumberEvent | null {
  const parsed = metaAccountUpdate.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const { event, restriction_info: restrictions = [], ban_info: ban } = parsed.data;
  if (event === "ACCOUNT_RESTRICTION") {
    const held = restrictions.filter(
      (restriction) => restriction.restriction_type === "RESTRICTED_BIZ_INITIATED_MESSAGING",
    );
    if (held.length === 0) {
      return { kind: "unrestricted" };
    }
    const expirations = held.map((restriction) => restriction.expiration);
    const until = expirations.every((expiration) => expiration !== undefined)
      ? Math.max(...expirations) * 1000
      : null;
    return { kind: "restricted", until };
  }
  if (event === "DISABLED_UPDATE" && ban?.waba_ban_state === "DISABLE") {
    return { kind: "disabled" };
  }
  if (event === "DISABLED_UPDATE" && ban?.waba_ban_state === "REINSTATE") {
    return { kind: "reinstated" };
  }
  return null;
}

function messagingLimitOf(value: unknown): WhatsappNumberEvent | null {
  const parsed = metaQualityUpdate.safeParse(value);
  const limit = parsed.success
    ? (parsed.data.max_daily_conversations_per_business ?? parsed.data.current_limit)
    : undefined;
  return limit ? { kind: "messagingLimit", limit } : null;
}

/** The events of a change about the account: a template's status or category, or the number's limits. */
function accountEventsOf(change: MetaChange): WhatsappEvents | null {
  if (change.field === "message_template_status_update") {
    const status = templateStatusOf(change.value);
    return status && { ...noEvents(), templateStatuses: [status] };
  }
  if (change.field === "template_category_update") {
    return templateCategoryOf(change.value);
  }
  const event =
    change.field === "account_update"
      ? accountEventOf(change.value)
      : change.field === "phone_number_quality_update"
        ? messagingLimitOf(change.value)
        : null;
  return event && { ...noEvents(), numberEvents: [event] };
}

/**
 * A change's events, with the lookup of whose they are, run when the call's
 * changes are read one by one: the number's organization for a `messages`
 * change, the account's for the others. `null` for a change underthing does
 * not store.
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
  const events = accountEventsOf(change);
  if (!events) {
    return null;
  }
  const lookup = async () => (accountId ? find.forAccount(accountId) : null);
  return { lookup, events };
}

function isEmpty(events: WhatsappEvents) {
  return [
    events.messages,
    events.statuses,
    events.templateStatuses,
    events.templateCategories ?? [],
    events.numberEvents ?? [],
  ].every((list) => list.length === 0);
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
  ours.templateCategories = [
    ...(ours.templateCategories ?? []),
    ...(events.templateCategories ?? []),
  ];
  ours.numberEvents = [...(ours.numberEvents ?? []), ...(events.numberEvents ?? [])];
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
    if (isEmpty(organizationEvents)) {
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
