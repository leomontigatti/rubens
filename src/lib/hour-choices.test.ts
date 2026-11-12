import { describe, expect, it } from "vite-plus/test";

import {
  cutoffChoices,
  durationChoices,
  handoffReminderChoices,
  returnTimeChoices,
} from "#/lib/hour-choices.ts";

const labels = (choices: { label: string }[]) => choices.map((one) => one.label);
const values = (choices: { value: string }[]) => choices.map((one) => one.value);

describe("a medical service's duration", () => {
  it("goes from 15 minutes to 3 hours in steps of 15", () => {
    const choices = durationChoices(30);

    expect(values(choices)).toEqual([
      "15",
      "30",
      "45",
      "60",
      "75",
      "90",
      "105",
      "120",
      "135",
      "150",
      "165",
      "180",
    ]);
    expect(labels(choices)).toEqual([
      "15 min",
      "30 min",
      "45 min",
      "1 h",
      "1 h 15 min",
      "1 h 30 min",
      "1 h 45 min",
      "2 h",
      "2 h 15 min",
      "2 h 30 min",
      "2 h 45 min",
      "3 h",
    ]);
  });

  it("keeps a stored duration outside the list, in its place", () => {
    expect(labels(durationChoices(20)).slice(0, 3)).toEqual(["15 min", "20 min", "30 min"]);
    expect(labels(durationChoices(240)).at(-1)).toBe("4 h");
  });
});

describe("a medical service's reschedule cutoff", () => {
  it("goes from the appointment itself to 2 days before, in steps of 6 hours", () => {
    expect(cutoffChoices(24)).toEqual([
      { value: "0", label: "Hasta el turno" },
      { value: "6", label: "6 h antes" },
      { value: "12", label: "12 h antes" },
      { value: "18", label: "18 h antes" },
      { value: "24", label: "1 día antes" },
      { value: "30", label: "1 día y 6 h antes" },
      { value: "36", label: "1 día y 12 h antes" },
      { value: "42", label: "1 día y 18 h antes" },
      { value: "48", label: "2 días antes" },
    ]);
  });

  it("keeps a stored cutoff outside the list, in its place", () => {
    expect(labels(cutoffChoices(1)).slice(0, 3)).toEqual([
      "Hasta el turno",
      "1 h antes",
      "6 h antes",
    ]);
    expect(labels(cutoffChoices(72)).at(-1)).toBe("3 días antes");
  });
});

describe("the WhatsApp settings' hours", () => {
  it("offers 1 to 24 hours for the return time, and keeps a stored one outside the list", () => {
    expect(labels(returnTimeChoices(4))).toEqual(["1 h", "2 h", "4 h", "8 h", "12 h", "24 h"]);
    expect(values(returnTimeChoices(3))).toEqual(["1", "2", "3", "4", "8", "12", "24"]);
  });

  it("offers 1 to 12 hours for the handoff reminders, and keeps a stored one outside the list", () => {
    expect(labels(handoffReminderChoices(2))).toEqual([
      "1 h",
      "2 h",
      "3 h",
      "4 h",
      "6 h",
      "8 h",
      "12 h",
    ]);
    expect(values(handoffReminderChoices(10))).toEqual(["1", "2", "3", "4", "6", "8", "10", "12"]);
  });
});
