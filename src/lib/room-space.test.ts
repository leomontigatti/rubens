import fc from "fast-check";
import { describe, expect, it } from "vite-plus/test";

import { findCrowding } from "#/lib/room-space.ts";

function at(time: string) {
  return new Date(`2099-01-05T${time}:00Z`);
}

function presence(practitionerId: string, start: string, end: string) {
  return { practitionerId, start: at(start), end: at(end) };
}

const span = { start: at("12:00"), end: at("13:00") };

describe("room space", () => {
  it("is free while no other practitioner is present", () => {
    const lucia = presence("lucia", "12:00", "13:00");

    expect(findCrowding(span, "juan", [])).toBeNull();
    expect(findCrowding(span, "juan", [lucia])).toEqual([lucia]);
  });

  it("names those present at the first held moment, and none who only touch the span", () => {
    const presences = [
      presence("lucia", "12:00", "12:30"),
      presence("pedro", "12:30", "13:00"),
      presence("ana", "11:00", "12:00"),
    ];

    expect(findCrowding(span, "juan", presences)).toEqual([presences[0]]);
  });

  it("adds no practitioner where they are already present, and counts them where they are not", () => {
    const juan = presence("juan", "12:00", "12:30");
    const lucia = presence("lucia", "12:00", "13:00");

    expect(
      findCrowding({ start: at("12:00"), end: at("12:30") }, "juan", [juan, lucia]),
    ).toBeNull();
    expect(findCrowding(span, "juan", [juan, lucia])).toEqual([lucia]);
  });
});

describe("room space against a minute-by-minute sweep", () => {
  const minute = 60_000;
  const range = fc
    .tuple(fc.integer({ min: 0, max: 120 }), fc.integer({ min: 1, max: 60 }))
    .map(([start, length]) => ({
      start: new Date(+at("12:00") + start * minute),
      end: new Date(+at("12:00") + (start + length) * minute),
    }));
  const presences = fc.array(
    fc
      .tuple(fc.constantFrom("juan", "lucia", "pedro"), range)
      .map(([practitionerId, during]) => ({ practitionerId, ...during })),
    { maxLength: 6 },
  );

  // Catches a sweep that skips a moment between break points (a presence that
  // starts or ends inside another), counts a presence that only touches the
  // span, or returns those present at a later moment than the first crowded one.
  it("returns those present at the first minute another practitioner holds the room alone", () => {
    fc.assert(
      fc.property(range, presences, (span, all) => {
        let crowded: typeof all | null = null;
        for (let moment = +span.start; moment < +span.end && !crowded; moment += minute) {
          const present = all.filter((one) => +one.start <= moment && moment < +one.end);
          if (present.length > 0 && present.every((one) => one.practitionerId !== "juan")) {
            crowded = present;
          }
        }
        expect(findCrowding(span, "juan", all)).toEqual(crowded);
      }),
      { numRuns: 500 },
    );
  });
});
