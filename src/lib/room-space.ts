import type { TimeRange } from "#/lib/time-ranges.ts";

// Whether a room has space for one more practitioner over a span
// (docs/domain/appointments.md § Booking): at no moment of it may the
// distinct other practitioners present, through schedules or appointments,
// reach the room's capacity, except where the practitioner is already
// present and so adds no one. Pure.

export interface Presence extends TimeRange {
  practitionerId: string;
}

function intersects(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * The presences at the first moment of `span` where the room is full for
 * `practitionerId`, or `null` when it has space throughout.
 */
export function findCrowding<T extends Presence>(
  span: TimeRange,
  practitionerId: string,
  presences: readonly T[],
  capacity: number,
): T[] | null {
  const inside = presences.filter((presence) => intersects(presence, span));
  const points = [
    ...new Set(
      [span.start, span.end, ...inside.flatMap((presence) => [presence.start, presence.end])]
        .map(Number)
        .filter((point) => point >= +span.start && point <= +span.end),
    ),
  ].sort((a, b) => a - b);
  for (let index = 0; index + 1 < points.length; index += 1) {
    const moment = { start: new Date(points[index]!), end: new Date(points[index + 1]!) };
    const present = inside.filter((presence) => intersects(presence, moment));
    const others = new Set(present.map((presence) => presence.practitionerId));
    if (!others.delete(practitionerId) && others.size >= capacity) {
      return present;
    }
  }
  return null;
}
