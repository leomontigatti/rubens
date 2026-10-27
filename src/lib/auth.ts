import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { eq } from "drizzle-orm";

import { db } from "#/db/client.ts";
import * as schema from "#/db/schema/index.ts";
import type { AnyDatabase } from "#/db/tenant.ts";

import { ac, roles } from "#/lib/access.ts";

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
    // `mustChangePassword`.
    disabledPaths: ["/change-password"],
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

/**
 * Serves Better Auth over HTTP (`/api/auth/*`), except the organization
 * plugin's endpoints. Its member endpoints treat every admin as the creator,
 * so they would skip the staff services' rules, and its read endpoints show
 * every member to any member. The app calls the plugin only through
 * `auth.api` on the server, so every `/organization/*` path, present or
 * future, answers 404.
 */
export function handleAuthRequest(auth: Auth, request: Request) {
  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/api/auth/organization/")) {
    return Promise.resolve(new Response(null, { status: 404 }));
  }
  return auth.handler(request);
}
