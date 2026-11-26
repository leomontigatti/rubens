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
