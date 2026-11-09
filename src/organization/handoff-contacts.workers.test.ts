import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  adminCaller,
  addMember,
  addRefusedAdmin,
  addStaff,
  auditEntriesFor,
  setUpTestOrganization,
} from "#/organization/organization.test-support.ts";
import type { OrganizationStub } from "#/organization/organization.test-support.ts";

let organization: OrganizationStub;

beforeEach(async () => {
  ({ organization } = await setUpTestOrganization());
});

/** The member ids an admin reads back as the handoff contacts. */
async function contactIds() {
  const listed = await organization.handoffContacts(adminCaller);
  if (!listed.ok) {
    throw new Error(`handoffContacts refused: ${listed.reason}`);
  }
  return listed.members.filter((one) => one.handoffContact).map((one) => one.memberId);
}

describe("picking the handoff contacts", () => {
  it("saves the members an admin picks, and a later save replaces them", async () => {
    const lucia = await addStaff(organization, "Lucía Pérez");
    const rita = await addStaff(organization, "Rita Gómez", ["receptionist"]);

    expect(
      await organization.saveHandoffContacts(adminCaller, {
        memberIds: [lucia.caller.userId, rita.caller.userId],
      }),
    ).toEqual({ ok: true });
    expect((await contactIds()).sort()).toEqual([lucia.caller.userId, rita.caller.userId].sort());

    expect(
      await organization.saveHandoffContacts(adminCaller, { memberIds: [lucia.caller.userId] }),
    ).toEqual({ ok: true });
    expect(await contactIds()).toEqual([lucia.caller.userId]);
  });

  it("lists every active member, with whether they keep clinical records", async () => {
    const lucia = await addStaff(organization, "Lucía Pérez");
    const rita = await addStaff(organization, "Rita Gómez", ["receptionist"]);
    const gone = await addStaff(organization, "Pablo Ruiz");
    await organization.setMemberActive(adminCaller, {
      memberId: gone.caller.userId,
      active: false,
    });

    expect(await organization.handoffContacts(adminCaller)).toEqual({
      ok: true,
      members: [
        {
          memberId: adminCaller.userId,
          name: "Ana Admin",
          keepsClinicalRecords: false,
          handoffContact: false,
        },
        {
          memberId: lucia.caller.userId,
          name: "Lucía Pérez",
          keepsClinicalRecords: true,
          handoffContact: false,
        },
        {
          memberId: rita.caller.userId,
          name: "Rita Gómez",
          keepsClinicalRecords: false,
          handoffContact: false,
        },
      ],
    });
  });

  it("audits each member who became or stopped being a contact", async () => {
    const lucia = await addStaff(organization, "Lucía Pérez");
    const rita = await addStaff(organization, "Rita Gómez", ["receptionist"]);
    await organization.saveHandoffContacts(adminCaller, {
      memberIds: [lucia.caller.userId, rita.caller.userId],
    });
    await organization.saveHandoffContacts(adminCaller, { memberIds: [lucia.caller.userId] });

    const contactChanges = async (memberId: string) =>
      (await auditEntriesFor(organization, memberId))
        .filter((entry) => entry.action === "update")
        .map(({ userId, before, after }) => ({ userId, before, after }));
    expect(await contactChanges(lucia.caller.userId)).toEqual([
      {
        userId: adminCaller.userId,
        before: { handoffContact: false },
        after: { handoffContact: true },
      },
    ]);
    expect(await contactChanges(rita.caller.userId)).toEqual([
      {
        userId: adminCaller.userId,
        before: { handoffContact: false },
        after: { handoffContact: true },
      },
      {
        userId: adminCaller.userId,
        before: { handoffContact: true },
        after: { handoffContact: false },
      },
    ]);
  });

  it("refuses a save with no contact who keeps clinical records, and keeps the contacts", async () => {
    const lucia = await addStaff(organization, "Lucía Pérez");
    const rita = await addStaff(organization, "Rita Gómez", ["receptionist"]);
    await organization.saveHandoffContacts(adminCaller, { memberIds: [lucia.caller.userId] });

    // Removing the last contact who keeps clinical records, and saving none at all.
    for (const memberIds of [[rita.caller.userId], []]) {
      expect(await organization.saveHandoffContacts(adminCaller, { memberIds })).toEqual({
        ok: false,
        reason: "noClinicalContact",
      });
    }
    expect(await contactIds()).toEqual([lucia.caller.userId]);
  });

  it("counts no practitioner who does not keep clinical records", async () => {
    const lucia = await addStaff(organization, "Lucía Pérez");
    await organization.updateMember(adminCaller, {
      memberId: lucia.caller.userId,
      practitioner: {
        displayName: "Lucía Pérez",
        specialty: "",
        keepsClinicalRecords: false,
        gridMinutes: 30,
        color: "color1",
      },
    });

    expect(
      await organization.saveHandoffContacts(adminCaller, { memberIds: [lucia.caller.userId] }),
    ).toEqual({ ok: false, reason: "noClinicalContact" });
  });

  it("refuses a member who is not an active member", async () => {
    const lucia = await addStaff(organization, "Lucía Pérez");
    const gone = await addStaff(organization, "Pablo Ruiz");
    await organization.setMemberActive(adminCaller, {
      memberId: gone.caller.userId,
      active: false,
    });

    for (const stranger of [gone.caller.userId, "user-of-nobody"]) {
      expect(
        await organization.saveHandoffContacts(adminCaller, {
          memberIds: [lucia.caller.userId, stranger],
        }),
      ).toEqual({ ok: false, reason: "notFound" });
    }
    expect(await contactIds()).toEqual([]);
  });

  it("refuses every member who is not an admin, and changes nothing", async () => {
    const lucia = await addStaff(organization, "Lucía Pérez");
    const callers = [
      [await addMember(organization, ["receptionist"]), "forbidden"],
      [lucia.caller, "forbidden"],
      [await addRefusedAdmin(organization, "mustChangePassword"), "mustChangePassword"],
      [await addRefusedAdmin(organization, "deactivated"), "unauthenticated"],
      [{ userId: "user-of-nobody" }, "unauthenticated"],
    ] as const;

    for (const [caller, reason] of callers) {
      const refused = { ok: false, reason };
      expect(
        await organization.saveHandoffContacts(caller, { memberIds: [lucia.caller.userId] }),
      ).toEqual(refused);
      expect(await organization.handoffContacts(caller)).toEqual(refused);
    }
    expect(await contactIds()).toEqual([]);
  });
});
