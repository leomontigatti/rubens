import * as z from "zod";

export const defaultTimeZone = "America/Argentina/Buenos_Aires";

/**
 * Whether `value` names an IANA time zone. `Intl` also accepts offsets such as
 * `-03:00`, which follow no daylight-saving rules, so they are refused.
 */
function isTimeZone(value: string): boolean {
  if (/^[+-]/.test(value)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch (error) {
    if (error instanceof RangeError) {
      return false;
    }
    throw error;
  }
}

const name = z.string().trim().min(1).max(200);

/** An office's fields, shared by the form and the services. */
export const officeInputSchema = z.object({
  name,
  address: z.string().trim().min(1).max(500),
  timeZone: z.string().trim().refine(isTimeZone).default(defaultTimeZone),
});

export const officeUpdateSchema = officeInputSchema.extend({ officeId: z.uuid() });

/** A room's fields, shared by the form and the services. */
export const roomInputSchema = z.object({
  officeId: z.uuid(),
  name,
  capacity: z.int().min(1).max(100).default(1),
});

export const roomUpdateSchema = roomInputSchema.omit({ officeId: true }).extend({
  roomId: z.uuid(),
});

export const activeChangeSchema = z.object({ id: z.uuid(), active: z.boolean() });

export type OfficeInput = z.input<typeof officeInputSchema>;
export type OfficeUpdate = z.input<typeof officeUpdateSchema>;
export type RoomInput = z.input<typeof roomInputSchema>;
export type RoomUpdate = z.input<typeof roomUpdateSchema>;
export type ActiveChange = z.input<typeof activeChangeSchema>;
