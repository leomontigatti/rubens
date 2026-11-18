import * as z from "zod";

export const defaultTimeZone = "America/Argentina/Buenos_Aires";

function isIanaTimeZone(value: string): boolean {
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
const timeZone = z.string().trim().refine(isIanaTimeZone);
const capacity = z.int().min(1).max(100);

export const officeInputSchema = z.object({
  name,
  address: z.string().trim().min(1).max(500),
  timeZone: timeZone.default(defaultTimeZone),
});

export const officeUpdateSchema = officeInputSchema.extend({
  officeId: z.uuid(),
  timeZone: timeZone.optional(),
});

export const roomInputSchema = z.object({
  officeId: z.uuid(),
  name,
  capacity: capacity.default(1),
});

export const roomUpdateSchema = roomInputSchema.omit({ officeId: true }).extend({
  roomId: z.uuid(),
  capacity: capacity.optional(),
});

export const activeChangeSchema = z.object({ id: z.uuid(), active: z.boolean() });

export const placeReferenceSchema = activeChangeSchema.pick({ id: true });

export function capacityLabel(capacity: number): string {
  return capacity === 1 ? "1 profesional a la vez" : `${capacity} profesionales a la vez`;
}

export type OfficeInput = z.input<typeof officeInputSchema>;
export type OfficeUpdate = z.input<typeof officeUpdateSchema>;
export type RoomInput = z.input<typeof roomInputSchema>;
export type RoomUpdate = z.input<typeof roomUpdateSchema>;
export type ActiveChange = z.input<typeof activeChangeSchema>;
export type PlaceReference = z.input<typeof placeReferenceSchema>;
