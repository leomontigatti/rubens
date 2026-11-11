import { describe, expect, it } from "vite-plus/test";

import {
  mentionsSendTime,
  timingDueAt,
  timingEntry,
  timingFromEntry,
  timingRank,
  timingSchema,
} from "#/lib/template-timing.ts";
import { timingLabel } from "#/lib/whatsapp-template-copy.ts";

const hour = 60 * 60_000;
const appointment = { startsAt: 100 * hour, endsAt: 101 * hour };

describe("when a template goes", () => {
  it("counts before from the appointment's start and after from its end", () => {
    expect(timingDueAt({ when: "before", hours: 24 }, appointment, 0)).toBe(76 * hour);
    expect(timingDueAt({ when: "after", hours: 24 }, appointment, 0)).toBe(125 * hour);
  });

  it("goes at once on the booking and on the attendance", () => {
    expect(timingDueAt({ when: "booking" }, appointment, 7)).toBe(7);
    expect(timingDueAt({ when: "attended" }, appointment, 7)).toBe(7);
  });

  it("takes from 1 hour up to 30 days before or after, and nothing in between", () => {
    expect(timingSchema.safeParse({ when: "before", hours: 720 }).success).toBe(true);
    expect(timingSchema.safeParse({ when: "after", hours: 721 }).success).toBe(false);
    expect(timingSchema.safeParse({ when: "before", hours: 0 }).success).toBe(false);
    expect(timingSchema.safeParse({ when: "before", hours: 1.5 }).success).toBe(false);
  });

  it("sorts in the order its messages go around one appointment", () => {
    const timings = [
      { when: "after", hours: 48 },
      { when: "attended" },
      { when: "before", hours: 2 },
      { when: "after", hours: 24 },
      { when: "booking" },
      { when: "before", hours: 24 },
    ] as const;
    const sorted = [...timings].sort((a, b) => {
      const [x, y] = [timingRank(a), timingRank(b)];
      return x[0] - y[0] || x[1] - y[1];
    });
    expect(sorted).toEqual([
      { when: "booking" },
      { when: "before", hours: 24 },
      { when: "before", hours: 2 },
      { when: "attended" },
      { when: "after", hours: 24 },
      { when: "after", hours: 48 },
    ]);
  });
});

describe("a timing as the admin reads it", () => {
  it("is in days when it is whole days, and in hours otherwise, singular for one", () => {
    expect(timingLabel({ when: "before", hours: 24 })).toBe("1 día antes del turno");
    expect(timingLabel({ when: "before", hours: 72 })).toBe("3 días antes del turno");
    expect(timingLabel({ when: "after", hours: 1 })).toBe("1 hora después del turno");
    expect(timingLabel({ when: "before", hours: 36 })).toBe("36 horas antes del turno");
  });
});

describe("a text that says when it is sent", () => {
  it("is one with `mañana`, `hoy` or `en N horas`, in any case", () => {
    expect(mentionsSendTime("Te esperamos mañana a las {{hora}}.")).toBe(true);
    expect(mentionsSendTime("Hoy es tu turno.")).toBe(true);
    expect(mentionsSendTime("Tu turno es en 2 horas.")).toBe(true);
    expect(mentionsSendTime("Tu turno es en 1 hora.")).toBe(true);
  });

  it("is not one that only holds those letters inside another word, or names the date", () => {
    expect(mentionsSendTime("Traé tus mañanitas y el hoyo.")).toBe(false);
    expect(mentionsSendTime("Tu turno es el {{fecha}} a las {{hora}}.")).toBe(false);
    expect(mentionsSendTime("Llegá 10 minutos antes, en horario.")).toBe(false);
  });
});

describe("a timing as the template's form holds it", () => {
  it("shows whole days in days, and other hours in hours", () => {
    expect(timingEntry({ when: "before", hours: 48 })).toEqual({
      when: "before",
      amount: "2",
      unit: "days",
    });
    expect(timingEntry({ when: "after", hours: 36 })).toEqual({
      when: "after",
      amount: "36",
      unit: "hours",
    });
  });

  it("saves days as hours, and leaves an amount out for the timings at an event", () => {
    expect(timingFromEntry({ when: "before", amount: "2", unit: "days" })).toEqual({
      when: "before",
      hours: 48,
    });
    expect(timingFromEntry({ when: "booking", amount: "3", unit: "days" })).toEqual({
      when: "booking",
    });
  });

  it("refuses an empty or fractional amount, and more than 30 days", () => {
    const parse = (amount: string, unit: "hours" | "days") =>
      timingSchema.safeParse(timingFromEntry({ when: "after", amount, unit })).success;

    expect(parse("", "hours")).toBe(false);
    expect(parse("1.5", "hours")).toBe(false);
    expect(parse("31", "days")).toBe(false);
    expect(parse("30", "days")).toBe(true);
  });
});
