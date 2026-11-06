import process from "node:process";
import { parseArgs } from "node:util";

// Creates an organization and its first admin: there is no public sign-up, so
// this is how a business comes to exist. It posts to the Worker's setup
// endpoint (`src/server/organization-setup.ts`) with SETUP_SECRET, and the
// organization's object creates the admin in Clerk and in its member table.
// A second run for the same organization name changes nothing and says so.
//
// The password is a starting one: the admin must replace it at first sign-in.

const usage =
  'usage: pnpm setup:organization --url <worker url> --organization "<name>" --name "<admin name>" --email <admin email> --password <starting password>';

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    organization: { type: "string" },
    name: { type: "string" },
    email: { type: "string" },
    password: { type: "string" },
  },
});

const { url, organization, name, email, password } = values;
if (!url || !organization || !name || !email || !password) {
  console.error(usage);
  process.exit(1);
}

const secret = process.env.SETUP_SECRET;
if (!secret) {
  console.error("SETUP_SECRET is required: the value set with `wrangler secret put SETUP_SECRET`");
  process.exit(1);
}

const response = await fetch(new URL("/api/setup", url), {
  method: "POST",
  headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
  body: JSON.stringify({
    organizationName: organization,
    adminName: name,
    adminEmail: email,
    password,
  }),
});

if (response.status === 404 || response.status === 401) {
  console.error(
    `setup refused (${response.status}): the Worker has no SETUP_SECRET, or another one`,
  );
  process.exit(1);
}
const result = (await response.json()) as
  | { ok: true; organizationId: string; userId: string }
  | { ok: false; reason: string };
if (result.ok) {
  console.log(`created organization ${result.organizationId} with admin ${result.userId}`);
} else if (result.reason === "alreadySetUp") {
  console.log(`organization "${organization}" already exists; nothing changed`);
} else if (result.reason === "invalidOrganizationName") {
  console.error(`setup refused: "${organization}" needs a letter or digit for its id`);
  process.exitCode = 1;
} else {
  console.error(`setup refused: ${result.reason}`);
  process.exitCode = 1;
}
