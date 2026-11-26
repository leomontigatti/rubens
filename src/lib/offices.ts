import * as z from "zod";

const name = z.string().trim().min(1).max(200);

export const officeInputSchema = z.object({
  name,
  address: z.string().trim().min(1).max(500),
});

export const officeUpdateSchema = officeInputSchema.extend({
  officeId: z.uuid(),
});

export const roomInputSchema = z.object({
  officeId: z.uuid(),
  name,
});

export const roomUpdateSchema = roomInputSchema.omit({ officeId: true }).extend({
  roomId: z.uuid(),
});

export const activeChangeSchema = z.object({ id: z.uuid(), active: z.boolean() });

export const placeReferenceSchema = activeChangeSchema.pick({ id: true });

export type OfficeInput = z.input<typeof officeInputSchema>;
export type OfficeUpdate = z.input<typeof officeUpdateSchema>;
export type RoomInput = z.input<typeof roomInputSchema>;
export type RoomUpdate = z.input<typeof roomUpdateSchema>;
export type ActiveChange = z.input<typeof activeChangeSchema>;
export type PlaceReference = z.input<typeof placeReferenceSchema>;
