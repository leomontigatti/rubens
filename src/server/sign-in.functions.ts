import { createServerFn } from "@tanstack/react-start";
import { deleteCookie, setCookie } from "@tanstack/react-start/server";
import * as z from "zod";

import { seedDevOrganization } from "#/dev/seed.ts";
import { devOrganizationId, devUserCookie, organizationObject } from "#/server/caller.ts";
import { currentAuthMode, workerEnv } from "#/server/with-organization.ts";

// Signing in and out. With a Clerk secret, Clerk's own components sign in
// (ADR-0009); without one, the dev sign-in picks a member of the dev
// organization, seeded on its first use (`src/dev/seed.ts`).

function devOrganization() {
  return organizationObject(workerEnv, devOrganizationId);
}

/** The sign-in the page shows: Clerk's, or the dev one with the members it offers. */
export const getSignIn = createServerFn({ method: "GET" }).handler(async () => {
  if (currentAuthMode() === "clerk") {
    return { mode: "clerk" as const };
  }
  const organization = devOrganization();
  let members = await organization.activeMembers();
  if (members.length === 0) {
    await seedDevOrganization(organization, devOrganizationId);
    members = await organization.activeMembers();
  }
  return { mode: "dev" as const, members };
});

/** Signs in as an active member of the dev organization; refused outside dev mode. */
export const signInAsDevMember = createServerFn({ method: "POST" })
  .validator(z.object({ userId: z.string().min(1) }))
  .handler(async ({ data }) => {
    if (currentAuthMode() !== "dev") {
      return { ok: false as const, reason: "notDevMode" as const };
    }
    const members = await devOrganization().activeMembers();
    if (!members.some((member) => member.userId === data.userId)) {
      return { ok: false as const, reason: "unknownMember" as const };
    }
    setCookie(devUserCookie, data.userId, { path: "/", httpOnly: true, sameSite: "lax" });
    return { ok: true as const };
  });

/** Ends the dev sign-in's session. */
export const signOutOfDev = createServerFn({ method: "POST" }).handler(() => {
  deleteCookie(devUserCookie, { path: "/" });
  return { ok: true as const };
});
