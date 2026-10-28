import { tz } from "@date-fns/tz";
import { format } from "date-fns";

import { instantOf, toTimeRange } from "#/lib/time-ranges.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";

// Places one column's blocks (one practitioner's appointments, say) on a day,
// so the screen only draws the result. Pure, in minutes from the day's start.

export interface LayoutBlock extends TimeRange {
  id: string;
}

export interface PlacedBlock {
  id: string;
  /** Minutes from the day's start to the block's start. */
  top: number;
  /** The block's length in minutes, inside the day. */
  height: number;
  /** Which of the `lanes` side-by-side slots the block takes, from 0. */
  lane: number;
  /** How many slots its group of overlapping blocks shares the width between. */
  lanes: number;
}

const minute = 60_000;

/**
 * Every block inside `day`, clipped to it, in start order. Blocks that
 * overlap, directly or through a chain, form a group that shares the width:
 * each takes the first lane free at its start. Touching blocks do not overlap.
 */
export function layoutColumn(blocks: readonly LayoutBlock[], day: TimeRange): PlacedBlock[] {
  const inside = blocks
    .filter((block) => block.start < day.end && block.end > day.start)
    .map((block) => ({
      id: block.id,
      start: Math.max(+block.start, +day.start),
      end: Math.min(+block.end, +day.end),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const placed: PlacedBlock[] = [];
  let group: PlacedBlock[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;

  function closeGroup() {
    for (const member of group) {
      member.lanes = laneEnds.length;
    }
    group = [];
    laneEnds = [];
  }

  for (const block of inside) {
    if (block.start >= groupEnd) {
      closeGroup();
    }
    let lane = laneEnds.findIndex((end) => end <= block.start);
    if (lane === -1) {
      lane = laneEnds.length;
    }
    laneEnds[lane] = block.end;
    groupEnd = Math.max(groupEnd, block.end);
    const member = {
      id: block.id,
      top: (block.start - +day.start) / minute,
      height: (block.end - block.start) / minute,
      lane,
      lanes: 0,
    };
    group.push(member);
    placed.push(member);
  }
  closeGroup();
  return placed;
}

const firstHour = 8;
const lastHour = 20;

/**
 * The span of the local `date` in `timeZone` a day view shows: 08:00 to
 * 20:00, widened to whole hours to take in every range, within the day.
 */
export function visibleHours(
  ranges: readonly TimeRange[],
  date: string,
  timeZone: string,
): TimeRange {
  const day = toTimeRange({ kind: "days", firstDate: date, lastDate: date }, timeZone);
  let start = instantOf(date, `${String(firstHour).padStart(2, "0")}:00`, timeZone);
  let end = instantOf(date, `${lastHour}:00`, timeZone);
  for (const range of ranges) {
    if (range.start < start) {
      start = range.start <= day.start ? day.start : floorToHour(range.start, timeZone);
    }
    if (range.end > end) {
      end = range.end >= day.end ? day.end : ceilToHour(range.end, timeZone);
    }
  }
  return { start, end };
}

function floorToHour(instant: Date, timeZone: string): Date {
  const local = format(instant, "yyyy-MM-dd HH", { in: tz(timeZone) });
  const [date, hour] = local.split(" ");
  return instantOf(date!, `${hour}:00`, timeZone);
}

function ceilToHour(instant: Date, timeZone: string): Date {
  const floored = floorToHour(instant, timeZone);
  return +floored === +instant ? floored : new Date(+floored + 60 * minute);
}
