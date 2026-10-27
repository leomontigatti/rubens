import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { eq } from "drizzle-orm";

import { db } from "#/db/client.ts";
import * as schema from "#/db/schema/index.ts";
import type { AnyDatabase } from "#/db/tenant.ts";

import { ac, roles } from "./access.ts";

/**
 * Better Auth on one database: the app's (`auth` below), the owner connection
 * the setup script uses, or a test's PGlite.
 *
 * Accounts are never signed up: an admin, or the setup script for the first
 * admin, creates them (`src/server/accounts.ts`). `tanstackStartCookies` stays
 * last: it reads the cookies the plugins before it set.
 */
export function createAuth(database: AnyDatabase) {
  return betterAuth({
    database: drizzleAdapter(database, { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
    },
    // A password change goes through `changeOwnPassword`, which also clears
    // `mustChangePassword`. A member never leaves the organization on their
    // own: an admin deactivates them.
    disabledPaths: ["/change-password", "/organization/leave"],
    user: {
      additionalFields: {
        mustChangePassword: {
          type: "boolean",
          required: false,
          defaultValue: true,
          input: false,
        },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // A member belongs to exactly one organization (ADR-0002), so every
          // session starts in it and no screen asks which one to use. A
          // deactivated member gets no session: sign-in answers 403.
          before: async (session) => {
            const membership = await database.query.member.findFirst({
              columns: { organizationId: true, active: true },
              where: eq(schema.member.userId, session.userId),
            });
            if (membership && !membership.active) {
              throw APIError.from("FORBIDDEN", {
                code: "MEMBER_INACTIVE",
                message: "This member is deactivated.",
              });
            }
            return {
              data: { ...session, activeOrganizationId: membership?.organizationId ?? null },
            };
          },
        },
      },
    },
    plugins: [
      organization({
        ac,
        roles,
        creatorRole: "admin",
        allowUserToCreateOrganization: false,
        // Deactivating a member (src/server/staff.ts) keeps the row.
        schema: {
          member: {
            additionalFields: {
              active: { type: "boolean", required: false, defaultValue: true, input: false },
            },
          },
        },
      }),
      tanstackStartCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

export const auth = createAuth(db);
