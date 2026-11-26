import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  adminCaller,
  afterTheWait,
  expectOk,
  fakeMeta,
  patientWrites,
  scriptedModel,
  setUpBookingWorld,
} from "#/organization/organization.test-support.ts";

// What the patient assistant tells about the practice
// (docs/domain/assistant.md § For patients): the medical services patients can
// book by WhatsApp and the practitioners who offer each, from the
// organization's data only. Meta is faked at its HTTP boundary and the model
// scripted at its port.

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

async function offers(practitionerId: string, name: string, whatsappBooking = true) {
  return expectOk(
    await world.organization.createMedicalService(adminCaller, {
      practitionerId,
      name,
      durationMinutes: 30,
      whatsappBooking,
    }),
  ).medicalService;
}

/** Runs a turn that asks what the practice offers, and returns what list_medical_services gave. */
async function medicalServicesListed() {
  await patientWrites(world.organization, "qué atienden?", martinaPhone);
  let listed: unknown;
  scriptedModel.script((one) => {
    one.call("judge_messages", { healthQuestion: false, emergency: false });
    listed = one.call("list_medical_services");
    return "Atendemos consultas.";
  });
  await afterTheWait(world.organization);
  return listed;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2099-01-01T12:00:00Z"));
  fakeMeta.reset();
  scriptedModel.reset();
  world = await setUpBookingWorld();
  await world.addPatient("Martina", martinaPhone);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the medical services the assistant lists", () => {
  it("are the active ones patients can book by WhatsApp, each with the practitioners who offer it", async () => {
    await offers(world.juan.practitionerId, "Consulta");
    await offers(world.lucia.practitionerId, "Consulta");
    await offers(world.lucia.practitionerId, "Control");
    const archived = await offers(world.juan.practitionerId, "Limpieza");
    expectOk(
      await world.organization.setMedicalServiceActive(adminCaller, {
        id: archived.id,
        active: false,
      }),
    );
    await offers(world.juan.practitionerId, "Cirugía", false);

    expect(await medicalServicesListed()).toEqual({
      medicalServices: [
        { name: "Consulta", practitioners: ["Juan Gómez", "Lucía Díaz"] },
        { name: "Control", practitioners: ["Lucía Díaz"] },
      ],
    });
  });

  it("leave out those of a deactivated practitioner", async () => {
    await offers(world.juan.practitionerId, "Consulta");
    await offers(world.lucia.practitionerId, "Consulta");
    expectOk(
      await world.organization.setMemberActive(adminCaller, {
        memberId: world.lucia.caller.userId,
        active: false,
      }),
    );

    expect(await medicalServicesListed()).toEqual({
      medicalServices: [{ name: "Consulta", practitioners: ["Juan Gómez"] }],
    });
  });
});
