import { beforeEach, describe, expect, it } from "vite-plus/test";

import { maxToneLength } from "#/lib/communication-rules.ts";

import {
  addMember,
  addRefusedAdmin,
  adminCaller,
  auditEntriesFor,
  expectOk,
  setUpTestOrganization,
} from "#/organization/organization.test-support.ts";
import type { OrganizationStub } from "#/organization/organization.test-support.ts";

let organization: OrganizationStub;

const usted = {
  formOfAddress: "usted",
  signOff: "Consultorios Prueba",
  tone: "Cordial y breve. Tratar a cada paciente por su nombre.",
  phone: "",
} as const;

/** The rules the WhatsApp settings show. */
async function shownRules() {
  return expectOk(await organization.whatsappSettings(adminCaller)).communicationRules;
}

beforeEach(async () => {
  ({ organization } = await setUpTestOrganization());
});

describe("the organization's communication rules", () => {
  it("start as `vos`, with no sign-off and no tone, at version 0", async () => {
    expect(await shownRules()).toEqual({
      formOfAddress: "vos",
      signOff: "",
      tone: "",
      phone: "",
      version: 0,
    });
  });

  it("are saved by an admin, raising the version by one each save", async () => {
    expectOk(await organization.saveCommunicationRules(adminCaller, usted));

    expect(await shownRules()).toEqual({ ...usted, version: 1 });

    expectOk(await organization.saveCommunicationRules(adminCaller, { ...usted, tone: "Cálido." }));

    expect(await shownRules()).toEqual({ ...usted, tone: "Cálido.", version: 2 });
  });

  it("are saved without the spaces around each text", async () => {
    expectOk(
      await organization.saveCommunicationRules(adminCaller, {
        ...usted,
        signOff: "  Consultorios Prueba ",
        tone: "\nCordial y breve. Tratar a cada paciente por su nombre.  ",
      }),
    );

    expect(await shownRules()).toEqual({ ...usted, version: 1 });
  });

  it("raise the version and audit a save even when it changes nothing", async () => {
    expectOk(await organization.saveCommunicationRules(adminCaller, usted));
    expectOk(await organization.saveCommunicationRules(adminCaller, usted));

    expect((await shownRules()).version).toBe(2);
    expect((await auditEntriesFor(organization, "communicationRules")).at(-1)).toMatchObject({
      before: { version: 1 },
      after: { version: 2 },
    });
  });

  it("audit each save with what changed and the version it made", async () => {
    expectOk(await organization.saveCommunicationRules(adminCaller, usted));
    expectOk(
      await organization.saveCommunicationRules(adminCaller, { ...usted, formOfAddress: "vos" }),
    );

    expect(await auditEntriesFor(organization, "communicationRules")).toEqual([
      {
        action: "update",
        entityType: "communicationRules",
        userId: adminCaller.userId,
        patientId: null,
        before: { formOfAddress: "vos", signOff: "", tone: "", version: 0 },
        after: { formOfAddress: "usted", signOff: usted.signOff, tone: usted.tone, version: 1 },
      },
      {
        action: "update",
        entityType: "communicationRules",
        userId: adminCaller.userId,
        patientId: null,
        before: { formOfAddress: "usted", version: 1 },
        after: { formOfAddress: "vos", version: 2 },
      },
    ]);
  });

  it("save the organization's phone as E.164, typed the local way", async () => {
    expectOk(
      await organization.saveCommunicationRules(adminCaller, {
        ...usted,
        phone: "0351 15 555-1234",
      }),
    );

    expect(await shownRules()).toMatchObject({ phone: "+5493515551234" });
  });

  it("refuse a phone that is not one, saving nothing", async () => {
    expect(
      await organization.saveCommunicationRules(adminCaller, { ...usted, phone: "15 555-1234" }),
    ).toEqual({ ok: false, reason: "missingAreaCode" });
    expect(
      await organization.saveCommunicationRules(adminCaller, { ...usted, phone: "12" }),
    ).toEqual({ ok: false, reason: "invalidPhone" });
    expect((await shownRules()).version).toBe(0);
  });

  it("refuse a tone over the limit, saving nothing", async () => {
    const result = await organization.saveCommunicationRules(adminCaller, {
      ...usted,
      tone: "a".repeat(maxToneLength + 1),
    });

    expect(result).toEqual({ ok: false, reason: "toneTooLong" });
    expect(await shownRules()).toEqual({
      formOfAddress: "vos",
      signOff: "",
      tone: "",
      phone: "",
      version: 0,
    });
  });

  it("are saved by admins only", async () => {
    const receptionist = await addMember(organization, ["receptionist"]);
    const practitioner = await addMember(organization, ["practitioner"]);
    const mustChange = await addRefusedAdmin(organization, "mustChangePassword");
    const deactivated = await addRefusedAdmin(organization, "deactivated");

    expect(await organization.saveCommunicationRules(receptionist, usted)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(await organization.saveCommunicationRules(practitioner, usted)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(await organization.saveCommunicationRules(mustChange, usted)).toEqual({
      ok: false,
      reason: "mustChangePassword",
    });
    expect(await organization.saveCommunicationRules(deactivated, usted)).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
    expect((await shownRules()).version).toBe(0);
  });
});
