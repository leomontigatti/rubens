import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  addMember,
  addRefusedAdmin,
  adminCaller,
  expectOk,
  fakeMeta,
  setUpTestOrganization,
} from "#/organization/organization.test-support.ts";
import type { OrganizationStub } from "#/organization/organization.test-support.ts";

// The object reaches Meta only through its Graph API client, whose HTTP calls
// go to the fake Meta: each test reads the requests it received.
vi.mock(import("#/organization/graph-api.ts"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    whatsappCloudFor: (connection) => actual.whatsappCloudFor(connection, fakeMeta.fetch),
    metaSignupFor: () => actual.metaSignupFor(fakeMeta.signupSettings, fakeMeta.fetch),
    configuredWhatsappSettings: () => fakeMeta.settings,
  };
});

let organization: OrganizationStub;

beforeEach(async () => {
  vi.restoreAllMocks();
  fakeMeta.reset();
  ({ organization } = await setUpTestOrganization());
});

describe("the WhatsApp settings", () => {
  it("log the setting the Worker misses, and show the admin none of it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    delete fakeMeta.settings.WHATSAPP_PHONE_NUMBER_ID;

    const settings = expectOk(await organization.whatsappSettings(adminCaller));

    expect(settings).not.toHaveProperty("missing");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("WHATSAPP_PHONE_NUMBER_ID"));
  });

  it("log nothing while the Worker has every setting", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expectOk(await organization.whatsappSettings(adminCaller));

    expect(warn).not.toHaveBeenCalled();
  });

  it("are refused to anyone but a signed-in admin", async () => {
    const callers = [
      await addMember(organization, ["receptionist"]),
      await addMember(organization, ["practitioner"]),
      { userId: "user-stranger" },
      await addRefusedAdmin(organization, "mustChangePassword"),
    ];

    const answers = await Promise.all(
      callers.map(async (caller) => {
        const answer = await organization.whatsappSettings(caller);
        return answer.ok ? "shown" : answer.reason;
      }),
    );
    expect(answers).toEqual(["forbidden", "forbidden", "unauthenticated", "mustChangePassword"]);
  });
});
