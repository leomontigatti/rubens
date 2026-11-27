import fc from "fast-check";
import { describe, expect, it } from "vite-plus/test";

import {
  layoutCells,
  layoutColumn,
  layoutDay,
  visibleHours,
  visibleWeekHours,
} from "#/lib/calendar-layout.ts";
import type { PlacedBlock } from "#/lib/calendar-layout.ts";

const day = { start: at("08:00"), end: at("20:00") };

function at(time: string) {
  return new Date(`2099-01-05T${time}:00Z`);
}

function block(id: string, start: string, end: string) {
  return { id, start: at(start), end: at(end) };
}

describe("laying out one column's day", () => {
  it("places blocks that do not overlap in one full-width lane, by minutes from the day's start", () => {
    expect(layoutColumn([block("b", "10:00", "10:30"), block("a", "08:30", "09:15")], day)).toEqual(
      [
        { id: "a", top: 30, height: 45, lane: 0, lanes: 1 },
        { id: "b", top: 120, height: 30, lane: 0, lanes: 1 },
      ],
    );
  });

  it("puts two overlapping blocks side by side", () => {
    const placed = layoutColumn([block("a", "09:00", "10:00"), block("b", "09:30", "10:30")], day);

    expect(placed).toEqual([
      { id: "a", top: 60, height: 60, lane: 0, lanes: 2 },
      { id: "b", top: 90, height: 60, lane: 1, lanes: 2 },
    ]);
  });

  it("gives three mutually overlapping blocks three lanes", () => {
    const placed = layoutColumn(
      [block("a", "09:00", "10:00"), block("b", "09:15", "09:45"), block("c", "09:30", "10:30")],
      day,
    );

    expect(placed.map(({ id, lane, lanes }) => ({ id, lane, lanes }))).toEqual([
      { id: "a", lane: 0, lanes: 3 },
      { id: "b", lane: 1, lanes: 3 },
      { id: "c", lane: 2, lanes: 3 },
    ]);
  });

  it("reuses a freed lane in a chain of overlaps, which all share the chain's width", () => {
    const placed = layoutColumn(
      [block("a", "09:00", "09:30"), block("b", "09:15", "10:00"), block("c", "09:45", "10:15")],
      day,
    );

    expect(placed.map(({ id, lane, lanes }) => ({ id, lane, lanes }))).toEqual([
      { id: "a", lane: 0, lanes: 2 },
      { id: "b", lane: 1, lanes: 2 },
      { id: "c", lane: 0, lanes: 2 },
    ]);
  });

  it("gives a cancelled block shown beside active ones its own lane, so no two overlap", () => {
    const placed = layoutColumn(
      [
        block("active", "09:00", "10:00"),
        block("cancelled", "09:00", "09:30"),
        block("next", "09:30", "10:30"),
      ],
      day,
    );

    expect(placed).toEqual([
      { id: "cancelled", top: 60, height: 30, lane: 0, lanes: 2 },
      { id: "active", top: 60, height: 60, lane: 1, lanes: 2 },
      { id: "next", top: 90, height: 60, lane: 0, lanes: 2 },
    ]);
  });

  it("keeps blocks that touch end to start in one lane", () => {
    const placed = layoutColumn([block("a", "09:00", "09:30"), block("b", "09:30", "10:00")], day);

    expect(placed.map(({ lane, lanes }) => ({ lane, lanes }))).toEqual([
      { lane: 0, lanes: 1 },
      { lane: 0, lanes: 1 },
    ]);
  });

  it("clips blocks at the day's edges and leaves out those outside it", () => {
    const placed = layoutColumn(
      [
        block("early", "07:30", "08:30"),
        block("late", "19:45", "20:30"),
        block("before", "07:00", "08:00"),
        block("after", "20:00", "21:00"),
      ],
      day,
    );

    expect(placed).toEqual([
      { id: "early", top: 0, height: 30, lane: 0, lanes: 1 },
      { id: "late", top: 705, height: 15, lane: 0, lanes: 1 },
    ]);
  });
});

describe("the hours a day view shows", () => {
  const zone = "America/Argentina/Buenos_Aires";
  const local = (time: string) => new Date(`2099-01-05T${time}:00-03:00`);

  it("shows 08:00 to 20:00 when nothing falls outside them", () => {
    expect(
      visibleHours([{ start: local("09:00"), end: local("13:00") }], "2099-01-05", zone),
    ).toEqual({ start: local("08:00"), end: local("20:00") });
  });

  it("widens to whole hours around an earlier start or a later end", () => {
    expect(
      visibleHours(
        [
          { start: local("07:30"), end: local("09:00") },
          { start: local("19:00"), end: local("21:15") },
        ],
        "2099-01-05",
        zone,
      ),
    ).toEqual({ start: local("07:00"), end: local("22:00") });
  });

  it("stops at the day's midnights", () => {
    expect(
      visibleHours(
        [{ start: local("22:00"), end: new Date("2099-01-06T01:00:00-03:00") }],
        "2099-01-05",
        zone,
      ),
    ).toEqual({ start: local("08:00"), end: new Date("2099-01-06T00:00:00-03:00") });
  });
});

describe("the hours a week view shows", () => {
  const zone = "America/Argentina/Buenos_Aires";
  const local = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`);

  it("shows every day from the earliest start to the latest end of any day", () => {
    expect(
      visibleWeekHours(
        [
          {
            date: "2099-01-05",
            ranges: [{ start: local("2099-01-05", "07:30"), end: local("2099-01-05", "09:00") }],
          },
          {
            date: "2099-01-06",
            ranges: [{ start: local("2099-01-06", "19:00"), end: local("2099-01-06", "21:00") }],
          },
        ],
        zone,
      ),
    ).toEqual([
      { start: local("2099-01-05", "07:00"), end: local("2099-01-05", "21:00") },
      { start: local("2099-01-06", "07:00"), end: local("2099-01-06", "21:00") },
    ]);
  });
});

describe("a day's 30-minute cells", () => {
  const view = { start: at("09:00"), end: at("11:00") };

  it("stacks the view in 30-minute cells by minutes from its start, none free without free starts", () => {
    expect(layoutCells(view, [])).toEqual([
      { start: at("09:00"), top: 0, height: 30, free: [] },
      { start: at("09:30"), top: 30, height: 30, free: [] },
      { start: at("10:00"), top: 60, height: 30, free: [] },
      { start: at("10:30"), top: 90, height: 30, free: [] },
    ]);
  });

  it("makes a cell free when a free start sits on its start, carrying it", () => {
    const free = { start: at("09:30"), practitionerId: "ana" };

    expect(layoutCells(view, [free]).map((cell) => cell.free)).toEqual([[], [free], [], []]);
  });

  it("carries every practitioner free on a cell's start, in the order given", () => {
    const ana = { start: at("10:00"), practitionerId: "ana" };
    const juan = { start: at("10:00"), practitionerId: "juan" };
    const onlyJuan = { start: at("10:30"), practitionerId: "juan" };

    expect(layoutCells(view, [ana, juan, onlyJuan]).map((cell) => cell.free)).toEqual([
      [],
      [],
      [ana, juan],
      [onlyJuan],
    ]);
  });

  it("leaves a cell grey when its only free start is inside it, not on its start", () => {
    expect(
      layoutCells(view, [{ start: at("09:15") }, { start: at("10:45") }]).some(
        (cell) => cell.free.length > 0,
      ),
    ).toBe(false);
  });

  it("ends a view that is not a whole number of cells with a shorter cell", () => {
    expect(layoutCells({ start: at("09:00"), end: at("09:45") }, []).at(-1)).toEqual({
      start: at("09:30"),
      top: 30,
      height: 15,
      free: [],
    });
  });
});

describe("a day's cells and cards together", () => {
  const view = { start: at("09:00"), end: at("10:00") };

  it("puts a free cell's click beside a card at the same time, so both stay reachable", () => {
    const free = { start: at("09:00"), practitionerId: "lucia" };

    const { cells, cards } = layoutDay(view, [free], [block("juan", "09:00", "09:30")]);

    expect(cards).toEqual([{ id: "juan", top: 0, height: 30, lane: 0, lanes: 2 }]);
    expect(cells[0]).toMatchObject({ free: [free], lane: 1, lanes: 2 });
  });

  it("gives a card over grey cells, and a free cell with no card, the whole width", () => {
    const free = { start: at("09:30"), practitionerId: "lucia" };

    const { cells, cards } = layoutDay(view, [free], [block("juan", "09:00", "09:30")]);

    expect(cards).toEqual([{ id: "juan", top: 0, height: 30, lane: 0, lanes: 1 }]);
    expect(cells.map(({ lane, lanes }) => ({ lane, lanes }))).toEqual([
      { lane: 0, lanes: 1 },
      { lane: 0, lanes: 1 },
    ]);
  });

  it("keeps a free cell's click beside every card that meets it, faded ones included", () => {
    const free = { start: at("09:00"), practitionerId: "lucia" };

    const { cells, cards } = layoutDay(
      view,
      [free],
      [block("active", "09:00", "10:00"), block("cancelled", "09:15", "09:45")],
    );

    const lanes = [...cards.map((card) => card.lane), cells[0]!.lane];
    expect(new Set(lanes).size).toBe(3);
    expect(cells[0]!.lanes).toBe(3);
  });
});

describe("laying out any column", () => {
  const minute = 60_000;
  const blocks = fc.array(
    fc
      .tuple(fc.integer({ min: 0, max: 60 }), fc.integer({ min: 1, max: 16 }))
      .map(([start, length]) => ({ start: start * 15 - 120, end: (start + length) * 15 - 120 })),
    { maxLength: 10 },
  );
  const placedOf = (spans: { start: number; end: number }[]) =>
    layoutColumn(
      spans.map(({ start, end }, index) => ({
        id: String(index),
        start: new Date(+day.start + start * minute),
        end: new Date(+day.start + end * minute),
      })),
      day,
    );
  const overlap = (a: PlacedBlock, b: PlacedBlock) =>
    a.top < b.top + b.height && b.top < a.top + a.height;

  // Catches a block inside the day left out or placed twice, a lane reused
  // while its block still runs, a lane count below the lanes used, and a chain
  // of overlaps that splits into groups of different widths.
  it("places every block in the day once, on a lane of its own while it overlaps, with its whole chain's lane count", () => {
    fc.assert(
      fc.property(blocks, (spans) => {
        const placed = placedOf(spans);
        const inDay = spans.flatMap(({ start, end }, index) =>
          start < 720 && end > 0 ? [String(index)] : [],
        );
        const byId = (a: string, b: string) => a.localeCompare(b);
        expect(placed.map((block) => block.id).sort(byId)).toEqual(inDay.sort(byId));
        for (const block of placed) {
          expect(block.lane).toBeGreaterThanOrEqual(0);
          expect(block.lane).toBeLessThan(block.lanes);
          for (const other of placed) {
            if (other !== block && overlap(block, other)) {
              expect(other.lane).not.toBe(block.lane);
              expect(other.lanes).toBe(block.lanes);
            }
          }
        }
      }),
      { numRuns: 500 },
    );
  });
});
