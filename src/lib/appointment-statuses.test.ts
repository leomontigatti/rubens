import { describe, expect, it } from "vite-plus/test";

import {
  cancellationText,
  decideStatusChange,
  decideUndo,
  statusActionsFor,
} from "#/lib/appointment-statuses.ts";
import type { StatusActor } from "#/lib/appointment-statuses.ts";
import type { AppointmentStatus } from "#/lib/appointments.ts";

// The office is in Buenos Aires (UTC-3): 09:00 there is 12:00Z, and its day
// ends at 03:00Z the next day.
const timeZone = "America/Argentina/Buenos_Aires";

function at(instant: string) {
  return new Date(`2099-01-05T${instant}:00Z`);
}

const start = at("12:00");

const reception: StatusActor = { roles: ["receptionist"], own: false };
const admin: StatusActor = { roles: ["admin"], own: false };
const ownPractitioner: StatusActor = { roles: ["practitioner"], own: true };
const otherPractitioner: StatusActor = { roles: ["practitioner"], own: false };

function change(status: AppointmentStatus, target: Parameters<typeof decideStatusChange>[1]) {
  return decideStatusChange({ status, start }, target, reception, at("13:00"));
}

describe("status changes", () => {
  it("allows each transition of the status diagram", () => {
    expect(change("booked", "confirmed")).toEqual({ ok: true, status: "confirmed" });
    expect(change("booked", "checkedIn")).toEqual({ ok: true, status: "checkedIn" });
    expect(change("confirmed", "checkedIn")).toEqual({ ok: true, status: "checkedIn" });
    expect(change("checkedIn", "attended")).toEqual({ ok: true, status: "attended" });
    for (const from of ["booked", "confirmed"] as const) {
      expect(change(from, "noShow")).toEqual({ ok: true, status: "noShow" });
      expect(change(from, "cancelled")).toEqual({ ok: true, status: "cancelled" });
    }
  });

  it("marks attended from booked or confirmed, passing through checked in", () => {
    expect(change("booked", "attended")).toEqual({ ok: true, status: "attended" });
    expect(change("confirmed", "attended")).toEqual({ ok: true, status: "attended" });
  });

  it("refuses every other transition", () => {
    const refused: [AppointmentStatus, Parameters<typeof change>[1]][] = [
      ["confirmed", "confirmed"],
      ["checkedIn", "confirmed"],
      ["checkedIn", "checkedIn"],
      ["checkedIn", "noShow"],
      ["checkedIn", "cancelled"],
      ["attended", "cancelled"],
      ["attended", "attended"],
      ["noShow", "checkedIn"],
      ["noShow", "cancelled"],
      ["cancelled", "confirmed"],
      ["cancelled", "attended"],
    ];
    for (const [from, target] of refused) {
      expect(change(from, target)).toEqual({ ok: false, reason: "notAllowed" });
    }
  });

  it("marks a no-show only once the start time has passed", () => {
    const appointment = { status: "booked" as const, start };

    expect(decideStatusChange(appointment, "noShow", reception, at("11:59"))).toEqual({
      ok: false,
      reason: "beforeStart",
    });
    expect(decideStatusChange(appointment, "noShow", reception, start)).toEqual({
      ok: true,
      status: "noShow",
    });
  });

  it("leaves check-in and no-show to reception and admins", () => {
    const appointment = { status: "booked" as const, start };
    for (const target of ["checkedIn", "noShow"] as const) {
      expect(decideStatusChange(appointment, target, admin, at("13:00")).ok).toBe(true);
      expect(decideStatusChange(appointment, target, ownPractitioner, at("13:00"))).toEqual({
        ok: false,
        reason: "forbidden",
      });
    }
  });

  it("lets the appointment's own practitioner, not another, confirm, cancel and mark attended", () => {
    const appointment = { status: "booked" as const, start };
    for (const target of ["confirmed", "cancelled", "attended"] as const) {
      expect(decideStatusChange(appointment, target, ownPractitioner, at("13:00")).ok).toBe(true);
      expect(decideStatusChange(appointment, target, otherPractitioner, at("13:00"))).toEqual({
        ok: false,
        reason: "forbidden",
      });
    }
  });
});

describe("undo", () => {
  const confirmedToday = {
    status: "checkedIn" as const,
    previousStatus: "confirmed" as const,
    statusChangedAt: at("12:05"),
    timeZone,
  };

  it("restores the previous status on the same local day", () => {
    // 02:59Z the next day is still 23:59 on the 5th in Buenos Aires.
    expect(decideUndo(confirmedToday, reception, new Date("2099-01-06T02:59:00Z"))).toEqual({
      ok: true,
      status: "confirmed",
    });
  });

  it("refuses the next local day", () => {
    expect(decideUndo(confirmedToday, reception, new Date("2099-01-06T03:00:00Z"))).toEqual({
      ok: false,
      reason: "tooLate",
    });
  });

  it("refuses when there is nothing to undo, as after an undo", () => {
    expect(decideUndo({ ...confirmedToday, previousStatus: null }, reception, at("13:00"))).toEqual(
      { ok: false, reason: "nothingToUndo" },
    );
  });

  it("is left to a role allowed to make the change undone", () => {
    expect(decideUndo(confirmedToday, ownPractitioner, at("13:00"))).toEqual({
      ok: false,
      reason: "forbidden",
    });
    const attended = { ...confirmedToday, status: "attended" as const };
    expect(decideUndo(attended, ownPractitioner, at("13:00"))).toEqual({
      ok: true,
      status: "confirmed",
    });
    expect(decideUndo(attended, otherPractitioner, at("13:00")).ok).toBe(false);
  });
});

describe("status actions", () => {
  it("offers the changes the actor may make now", () => {
    const appointment = { status: "booked" as const, start };

    expect(statusActionsFor(appointment, reception, at("11:00"))).toEqual([
      "confirmed",
      "checkedIn",
      "attended",
      "cancelled",
    ]);
    expect(statusActionsFor(appointment, ownPractitioner, at("13:00"))).toEqual([
      "confirmed",
      "attended",
      "cancelled",
    ]);
    expect(statusActionsFor({ status: "attended", start }, admin, at("13:00"))).toEqual([]);
  });
});

describe("cancellation text", () => {
  it("says who cancelled, and why when a reason was given", () => {
    expect(cancellationText({ cancelledBy: null, cancellationReason: null })).toBeNull();
    expect(cancellationText({ cancelledBy: "business", cancellationReason: null })).toBe(
      "Canceló: El consultorio",
    );
    expect(cancellationText({ cancelledBy: "patient", cancellationReason: "Viaja" })).toBe(
      "Canceló: El paciente (Viaja)",
    );
  });
});
