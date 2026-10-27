import process from "node:process";
import { parseArgs } from "node:util";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema/index.ts";
import { createAuth } from "#/lib/auth.ts";
import { setupOrganization } from "#/server/setup.ts";

// Creates an organization and its first admin: there is no public sign-up, so
// this is how a business comes to exist. It runs with the owner connection
// (`DATABASE_DIRECT_URL`, ADR-0002), and a second run for the same
// organization name changes nothing and says so.
//
// The password is a starting one: the admin must replace it at first sign-in.

const usage =
  'usage: pnpm setup:organization --organization "<name>" --name "<admin name>" --email <admin email> --password <starting password>';

const { values } = parseArgs({
  options: {
    organization: { type: "string" },
    name: { type: "string" },
    email: { type: "string" },
    password: { type: "string" },
  },
});

const { organization, name, email, password } = values;
if (!organization || !name || !email || !password) {
  console.error(usage);
  process.exit(1);
}

const connectionString = process.env.DATABASE_DIRECT_URL;
if (!connectionString) {
  console.error("DATABASE_DIRECT_URL is required; is .env present?");
  process.exit(1);
}

const pool = new Pool({ connectionString, max: 1 });
try {
  const auth = createAuth(drizzle(pool, { schema }));
  const result = await setupOrganization(auth, {
    organizationName: organization,
    adminName: name,
    adminEmail: email,
    password,
  });
  if (result.ok) {
    console.log(`created organization ${result.organizationId} with admin ${result.userId}`);
  } else if (result.reason === "organizationExists") {
    console.log(`organization "${organization}" already exists; nothing changed`);
  } else if (result.reason === "invalidOrganizationName") {
    console.error(`setup refused: "${organization}" needs a letter or digit for its slug`);
    process.exitCode = 1;
  } else {
    console.error(`setup refused: ${result.reason}`);
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
