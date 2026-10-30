import { describe, expect, it } from "vite-plus/test";

import { findCrowding } from "#/lib/room-space.ts";

// Instants on one day, as "HH:MM" UTC.
function at(time: string) {
  return new Date(`2099-01-05T${time}:00Z`);
}

function presence(practitionerId: string, start: string, end: string) {
  return { practitionerId, start: at(start), end: at(end) };
}

const span = { start: at("12:00"), end: at("13:00") };

describe("room space", () => {
  it("has space while fewer other practitioners than the capacity are present", () => {
    const lucia = presence("lucia", "12:00", "13:00");

    expect(findCrowding(span, "juan", [], 1)).toBeNull();
    expect(findCrowding(span, "juan", [lucia], 2)).toBeNull();
    expect(findCrowding(span, "juan", [lucia], 1)).toEqual([lucia]);
  });

  it("counts a practitioner present twice, by schedule and appointment, once", () => {
    const lucia = [presence("lucia", "12:00", "13:00"), presence("lucia", "12:15", "12:45")];

    expect(findCrowding(span, "juan", lucia, 2)).toBeNull();
  });

  it("counts only those present at the same moment, and none who only touch the span", () => {
    const presences = [
      presence("lucia", "12:00", "12:30"),
      presence("pedro", "12:30", "13:00"),
      presence("ana", "11:00", "12:00"),
    ];

    expect(findCrowding(span, "juan", presences, 2)).toBeNull();
    expect(findCrowding(span, "juan", presences, 1)).toEqual([presences[0]]);
  });

  it("adds no practitioner where they are already present, and counts them where they are not", () => {
    const juan = presence("juan", "12:00", "12:30");
    const lucia = presence("lucia", "12:00", "13:00");

    expect(
      findCrowding({ start: at("12:00"), end: at("12:30") }, "juan", [juan, lucia], 1),
    ).toBeNull();
    expect(findCrowding(span, "juan", [juan, lucia], 1)).toEqual([lucia]);
  });
});
