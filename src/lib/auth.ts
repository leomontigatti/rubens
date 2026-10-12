import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { tanstackStartCookies } from "better-auth/tanstack-start";

import { db } from "#/db/client.ts";
import * as schema from "#/db/schema/index.ts";

// Receptionist and professional become organization roles, defined with the
// first access feature. `tanstackStartCookies` stays last: it reads the cookies
// the plugins before it set.
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [organization(), tanstackStartCookies()],
});
