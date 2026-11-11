import * as z from "zod";

// When one of the organization's templates goes (docs/domain/messages.md § The
// organization's templates): when its appointment is booked, when it is
// marked attended, or some hours before its start or after its end. Stored
// as a kind and a number of hours.

export const timingKinds = ["booking", "attended", "before", "after"] as const;

export type TimingKind = (typeof timingKinds)[number];

/** The furthest a template goes before or after its appointment: 30 days. */
const maxTimingHours = 720;

const hoursSchema = z.int().min(1).max(maxTimingHours);

export const timingSchema = z.discriminatedUnion("when", [
  z.object({ when: z.literal("booking") }),
  z.object({ when: z.literal("attended") }),
  z.object({ when: z.literal("before"), hours: hoursSchema }),
  z.object({ when: z.literal("after"), hours: hoursSchema }),
]);

export type Timing = z.output<typeof timingSchema>;

/** The timings queued when an appointment is booked, and those when it is marked attended. */
export const bookingTimings = ["booking", "before"] as const satisfies TimingKind[];
export const attendedTimings = ["attended", "after"] as const satisfies TimingKind[];

/** A stored timing, or `null` for a template with none (an event template). */
export function timingOf(row: { timing: TimingKind | null; timingHours: number | null }) {
  switch (row.timing) {
    case null:
      return null;
    case "before":
    case "after":
      return row.timingHours === null
        ? null
        : ({ when: row.timing, hours: row.timingHours } satisfies Timing);
    default:
      return { when: row.timing } satisfies Timing;
  }
}

/** The columns `timing` is stored in. */
export function timingColumns(timing: Timing) {
  return { timing: timing.when, timingHours: "hours" in timing ? timing.hours : null };
}

/**
 * When a message timed `timing` goes for an appointment of `[startsAt, endsAt)`:
 * hours before its start or after its end; at once, `now`, on its booking or
 * its attendance.
 */
export function timingDueAt(
  timing: Timing,
  appointment: { startsAt: number; endsAt: number },
  now: number,
) {
  switch (timing.when) {
    case "before":
      return appointment.startsAt - timing.hours * 60 * 60_000;
    case "after":
      return appointment.endsAt + timing.hours * 60 * 60_000;
    default:
      return now;
  }
}

/** Where a timing sorts in a list: in the order its messages go around one appointment. */
export function timingRank(timing: Timing | null): [number, number] {
  switch (timing?.when) {
    case "booking":
      return [0, 0];
    case "before":
      return [1, -timing.hours];
    case "attended":
      return [2, 0];
    case "after":
      return [3, timing.hours];
    default:
      return [4, 0];
  }
}

const letter = String.raw`\p{L}`;

// Words that say when a message goes, which a late message would make wrong:
// `mañana`, `hoy`, `en 2 horas`.
const sendTimeWords = new RegExp(
  `(?<!${letter})(?:mañana|hoy|en\\s+\\d+\\s+horas?)(?!${letter})`,
  "iu",
);

/** Whether `body` says when it is sent instead of naming the date and time. */
export function mentionsSendTime(body: string) {
  return sendTimeWords.test(body);
}

/** A timing as the template's form holds it: an amount of hours or of days, as typed. */
export interface TimingEntry {
  when: TimingKind;
  amount: string;
  unit: "hours" | "days";
}

/** How the form shows `timing`: whole days in days, anything else in hours. */
export function timingEntry(timing: Timing): TimingEntry {
  if (!("hours" in timing)) {
    return { when: timing.when, amount: "", unit: "days" };
  }
  return timing.hours % 24 === 0
    ? { when: timing.when, amount: String(timing.hours / 24), unit: "days" }
    : { when: timing.when, amount: String(timing.hours), unit: "hours" };
}

/** The timing `entry` asks for, in hours, for `timingSchema` to check; an amount not typed is no number. */
export function timingFromEntry(entry: TimingEntry): unknown {
  if (entry.when !== "before" && entry.when !== "after") {
    return { when: entry.when };
  }
  const amount = entry.amount.trim() === "" ? Number.NaN : Number(entry.amount);
  return { when: entry.when, hours: amount * (entry.unit === "days" ? 24 : 1) };
}
