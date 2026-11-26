import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import {
  adminCaller,
  afterTheWait,
  answeringNotice,
  at,
  expectOk,
  fakeMeta,
  patientWrites,
  scriptedModel,
  setUpBookingWorld,
} from "#/organization/organization.test-support.ts";

// The free times the patient assistant offers for a new appointment
// (docs/domain/assistant.md § For patients): from availability, for a medical
// service patients can book by WhatsApp, the few nearest from the day and time
// the patient prefers, with one practitioner or across those who offer it,
// within 60 days. Meta is faked at its HTTP boundary and the model scripted at
// its port.

vi.mock(import("#/organization/graph-api.ts"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    whatsappCloudFor: (connection) => actual.whatsappCloudFor(connection, fakeMeta.fetch),
    metaSignupFor: () => actual.metaSignupFor(fakeMeta.signupSettings, fakeMeta.fetch),
    configuredWhatsappSettings: () => fakeMeta.settings,
  };
});

vi.mock(import("#/organization/assistant-model.ts"), async (original) => ({
  ...(await original()),
  assistantModelFor: () => scriptedModel,
}));

const martinaPhone = "+5491155550000";

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;

/** What find_booking_times returns: the free times, or why it found none. */
const bookingTimes = z.looseObject({
  ok: z.boolean(),
  reason: z.string().optional(),
  slots: z.array(z.looseObject({ slotId: z.string() })).optional(),
  more: z.boolean().optional(),
});

/** Runs a turn that asks for times, and returns what find_booking_times gave for `args`. */
async function bookingTimesAsked(args: Record<string, unknown>) {
  await patientWrites(world.organization, "quiero un turno", martinaPhone);
  let found: unknown;
  scriptedModel.script((one) => {
    one.call("judge_messages", { healthQuestion: false, emergency: false });
    found = one.call("find_booking_times", args);
    return "Tengo estos horarios.";
  });
  await afterTheWait(world.organization);
  return bookingTimes.parse(found);
}

/** A time as find_booking_times offers it, in January 2099, by what the patient reads. */
function time(practitioner: string, room: string, date: string, at: string) {
  return { practitioner, room, date, time: at };
}

async function offers(practitionerId: string, whatsappBooking = true) {
  return expectOk(
    await world.organization.createMedicalService(adminCaller, {
      practitionerId,
      name: "Consulta",
      durationMinutes: 30,
      whatsappBooking,
    }),
  ).medicalService;
}

beforeEach(async () => {
  // Thursday 1 January 2099. `juan` works Mondays from 09:00 to 11:00 in the
  // first room, `lucia` Mondays from 09:00 to 10:00 in the other, in Buenos Aires.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2099-01-01T12:00:00Z"));
  fakeMeta.reset();
  scriptedModel.reset();
  world = await setUpBookingWorld();
  await world.addSchedule({ practitionerId: world.juan.practitionerId });
  await world.addSchedule({
    practitionerId: world.lucia.practitionerId,
    roomId: world.otherRoom.id,
    endTime: "10:00",
  });
  await world.addPatient("Martina", martinaPhone);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the free times offered for a new appointment", () => {
  it("are the nearest from the preferred day across the practitioners who offer it, never a taken time, time off or a closure", async () => {
    const juanService = await offers(world.juan.practitionerId);
    await offers(world.lucia.practitionerId);
    const tomas = await world.addPatient("Tomás", "+5493515550002");
    await world.book({
      practitionerId: world.juan.practitionerId,
      patientId: tomas.id,
      medicalServiceId: juanService.id,
      start: at("12:00"),
      durationMinutes: 30,
    });
    expectOk(
      await answeringNotice(true, (notice) =>
        world.organization.createTimeOff(adminCaller, {
          practitionerId: world.lucia.practitionerId,
          entry: { kind: "days", firstDate: "2099-01-05", lastDate: "2099-01-05" },
          ...notice,
        }),
      ),
    );
    expectOk(
      await answeringNotice(true, (notice) =>
        world.organization.createClosure(adminCaller, {
          entry: { kind: "days", firstDate: "2099-01-12", lastDate: "2099-01-12" },
          ...notice,
        }),
      ),
    );

    const found = await bookingTimesAsked({ medicalService: "Consulta", from: "2099-01-05" });

    expect(found).toMatchObject({
      ok: true,
      medicalService: "Consulta",
      slots: [
        time("Juan Gómez", "Consultorio 1", "lunes 5 de enero", "09:30"),
        time("Juan Gómez", "Consultorio 1", "lunes 5 de enero", "10:00"),
        time("Juan Gómez", "Consultorio 1", "lunes 5 de enero", "10:30"),
        time("Juan Gómez", "Consultorio 1", "lunes 19 de enero", "09:00"),
        time("Lucía Díaz", "Consultorio 2", "lunes 19 de enero", "09:00"),
      ],
      more: true,
    });
    const slotIds = found.slots!.map((one) => one.slotId);
    expect(new Set(slotIds).size).toBe(slotIds.length);
  });

  it("are the named practitioner's only", async () => {
    await offers(world.juan.practitionerId);
    await offers(world.lucia.practitionerId);

    const found = await bookingTimesAsked({
      medicalService: "Consulta",
      practitioner: "Lucía Díaz",
      from: "2099-01-05",
    });

    expect(found).toMatchObject({
      ok: true,
      slots: [
        time("Lucía Díaz", "Consultorio 2", "lunes 5 de enero", "09:00"),
        time("Lucía Díaz", "Consultorio 2", "lunes 5 de enero", "09:30"),
        time("Lucía Díaz", "Consultorio 2", "lunes 12 de enero", "09:00"),
        time("Lucía Díaz", "Consultorio 2", "lunes 12 de enero", "09:30"),
        time("Lucía Díaz", "Consultorio 2", "lunes 19 de enero", "09:00"),
      ],
    });
  });

  it("start from the preferred day and time, so asking again from a later one shows other times", async () => {
    await offers(world.juan.practitionerId);

    const first = await bookingTimesAsked({ medicalService: "Consulta", from: "2099-01-05" });
    const found = await bookingTimesAsked({ medicalService: "Consulta", from: "2099-01-12T10:00" });

    expect(first).toMatchObject({
      slots: [
        time("Juan Gómez", "Consultorio 1", "lunes 5 de enero", "09:00"),
        time("Juan Gómez", "Consultorio 1", "lunes 5 de enero", "09:30"),
        time("Juan Gómez", "Consultorio 1", "lunes 5 de enero", "10:00"),
        time("Juan Gómez", "Consultorio 1", "lunes 5 de enero", "10:30"),
        time("Juan Gómez", "Consultorio 1", "lunes 12 de enero", "09:00"),
      ],
    });
    expect(found).toMatchObject({
      slots: [
        time("Juan Gómez", "Consultorio 1", "lunes 12 de enero", "10:00"),
        time("Juan Gómez", "Consultorio 1", "lunes 12 de enero", "10:30"),
        time("Juan Gómez", "Consultorio 1", "lunes 19 de enero", "09:00"),
        time("Juan Gómez", "Consultorio 1", "lunes 19 de enero", "09:30"),
        time("Juan Gómez", "Consultorio 1", "lunes 19 de enero", "10:00"),
      ],
    });
  });

  it("are never in the past", async () => {
    await offers(world.juan.practitionerId);
    // Monday 5 January at 09:40 in Buenos Aires.
    vi.setSystemTime(at("12:40"));

    const found = await bookingTimesAsked({ medicalService: "Consulta", from: "2099-01-01" });

    expect(found.slots?.[0]).toMatchObject(
      time("Juan Gómez", "Consultorio 1", "lunes 5 de enero", "10:00"),
    );
  });

  it("stop 60 days ahead", async () => {
    await offers(world.juan.practitionerId);
    // Thursday 1 January at 10:15 in Buenos Aires: the 60 days end on Monday 2 March at 10:15.
    vi.setSystemTime(new Date("2099-01-01T13:15:00Z"));

    const found = await bookingTimesAsked({ medicalService: "Consulta", from: "2099-03-02" });

    expect(found).toMatchObject({
      ok: true,
      slots: [
        time("Juan Gómez", "Consultorio 1", "lunes 2 de marzo", "09:00"),
        time("Juan Gómez", "Consultorio 1", "lunes 2 de marzo", "09:30"),
        time("Juan Gómez", "Consultorio 1", "lunes 2 de marzo", "10:00"),
      ],
      more: false,
    });
    expect(found.slots).toHaveLength(3);
  });
});

describe("a medical service the assistant finds no times for", () => {
  it("is one patients cannot book by WhatsApp", async () => {
    await offers(world.juan.practitionerId, false);

    expect(await bookingTimesAsked({ medicalService: "Consulta", from: "2099-01-05" })).toEqual({
      ok: false,
      reason: "whatsappBookingOff",
    });
  });

  it("is an archived one", async () => {
    const archived = await offers(world.juan.practitionerId);
    expectOk(
      await world.organization.setMedicalServiceActive(adminCaller, {
        id: archived.id,
        active: false,
      }),
    );

    expect(await bookingTimesAsked({ medicalService: "Consulta", from: "2099-01-05" })).toEqual({
      ok: false,
      reason: "archived",
    });
  });

  it("is one only a member who no longer holds the practitioner role offers", async () => {
    await offers(world.juan.practitionerId);
    expectOk(
      await world.organization.updateMember(adminCaller, {
        memberId: world.juan.caller.userId,
        roles: ["receptionist"],
      }),
    );

    expect(await bookingTimesAsked({ medicalService: "Consulta", from: "2099-01-05" })).toEqual({
      ok: false,
      reason: "notFound",
    });
  });

  it("is one the practice does not offer, or not with the practitioner named", async () => {
    await offers(world.juan.practitionerId);

    expect(await bookingTimesAsked({ medicalService: "Limpieza", from: "2099-01-05" })).toEqual({
      ok: false,
      reason: "notFound",
    });
    expect(
      await bookingTimesAsked({
        medicalService: "Consulta",
        practitioner: "Lucía Díaz",
        from: "2099-01-05",
      }),
    ).toEqual({ ok: false, reason: "notFound" });
  });
});
