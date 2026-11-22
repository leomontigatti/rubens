import { z } from "zod";

// The shapes of Meta's Graph API answers, for `graph-api.ts`.
//
// They are read leniently: a field Meta leaves out or sends in another
// shape reads as `null`, a malformed entry of a list as `null` too, and a body
// that is not an object as one with no fields. Each caller then decides what
// it cannot do without, and throws for that alone. The one exception is the
// account's numbers, whose list is an error when it is anything but a list.

/** A string field of Meta's answer: `null` when missing or of another type. */
const text = z.string().nullable().catch(null);

/** A list in Meta's answer: `null` when it is not one, each malformed entry `null`. */
function listOf<T extends z.ZodType>(entry: T) {
  return z.array(entry.nullable().catch(null)).nullable().catch(null);
}

/**
 * The first entry of a list in Meta's answer, read as `list?.[0]` reads it:
 * index 0 of any object, an array or not; `null` when absent or malformed.
 */
function firstOf<T extends z.ZodType>(entry: T) {
  return z.preprocess(
    (list): unknown => (typeof list === "object" && list !== null ? Reflect.get(list, 0) : null),
    entry.nullable().catch(null),
  );
}

/** `body` as an object of fields: one that is not an object has none. */
export function asFields(body: unknown): object {
  return typeof body === "object" && body !== null && !Array.isArray(body) ? body : {};
}

/** `body` read with `shape`, whose every field falls back, so the read never throws. */
export function fieldsOf<S extends z.ZodRawShape>(shape: S, body: unknown) {
  return z.object(shape).parse(asFields(body));
}

export const errorAnswer = {
  error: z
    .object({ message: text, code: z.number().nullable().catch(null) })
    .nullable()
    .catch(null),
};

/** A send's answer, of which only the first message and contact are read. */
export const messagesAnswer = {
  contacts: firstOf(z.object({ wa_id: text })),
  messages: firstOf(z.object({ id: text })),
};

export const templateListAnswer = {
  data: listOf(z.object({ name: text })),
  paging: z.object({ next: z.unknown() }).nullable().catch(null),
};

export const mediaAnswer = { url: text, mime_type: text };

export const tokenAnswer = { access_token: text };

export const templateAnswer = { id: text, status: text, rejected_reason: text };

/** The account's numbers: no list reads as none, and anything else but a list is an error. */
export const phoneNumbersAnswer = z.object({
  data: z
    .array(z.object({ id: z.unknown(), display_phone_number: text }).nullable().catch(null))
    .nullish(),
});

export const phoneNumberAnswer = { whatsapp_business_manager_messaging_limit: text };
