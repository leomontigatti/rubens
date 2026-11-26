import type { TimeRange } from "#/lib/time-ranges.ts";

// Whether a room is free for a practitioner over a span, a room holding one
// practitioner at a time (docs/domain/appointments.md § Booking), as a pure
// function.

export interface Presence extends TimeRange {
  practitionerId: string;
}

function intersects(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * The presences at the first moment of `span` where another practitioner
 * holds the room, or `null` when nobody else does throughout.
 */
export function findCrowding<T extends Presence>(
  span: TimeRange,
  practitionerId: string,
  presences: readonly T[],
): T[] | null {
  const inside = presences.filter((presence) => intersects(presence, span));
  const points = [
    ...new Set(
      [span.start, span.end, ...inside.flatMap((presence) => [presence.start, presence.end])]
        .map(Number)
        .filter((point) => point >= +span.start && point <= +span.end),
    ),
  ].sort((a, b) => a - b);
  const [first, ...rest] = points;
  if (first === undefined) {
    return null;
  }
  let start = first;
  for (const end of rest) {
    const moment = { start: new Date(start), end: new Date(end) };
    const present = inside.filter((presence) => intersects(presence, moment));
    if (
      present.length > 0 &&
      !present.some((presence) => presence.practitionerId === practitionerId)
    ) {
      return present;
    }
    start = end;
  }
  return null;
}
