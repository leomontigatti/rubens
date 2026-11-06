import process from "node:process";
import { parseArgs } from "node:util";

import { mondayOf } from "#/lib/appointments.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { shiftDate, today } from "#/lib/schedules.ts";

// Books the busy weeks the agenda's CPU budget is measured on (#139,
// `src/dev/agenda-week.ts`), one request per week, from next week on: the
// Workers prototype's ~1,600 appointments over 13 weeks. Against a Worker in
// dev mode it signs in as the dev admin; against one with Clerk it needs an
// admin's session token and the Worker's SEED_SECRET.

const usage =
  "usage: pnpm seed:agenda-week --url <worker url> [--weeks 13] [--practitioner <user id>]\n" +
  "  with Clerk: SESSION_TOKEN=<an admin's session token> SEED_SECRET=<the Worker's>";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    weeks: { type: "string", default: "13" },
    practitioner: { type: "string" },
  },
});

const weeks = Number(values.weeks);
if (!values.url || !Number.isInteger(weeks) || weeks < 1) {
  console.error(usage);
  process.exit(1);
}

const token = process.env.SESSION_TOKEN;
const headers: Record<string, string> = { "content-type": "application/json" };
if (token) {
  headers.authorization = `Bearer ${token}`;
  headers["x-seed-secret"] = process.env.SEED_SECRET ?? "";
} else {
  headers.cookie = "rubens_dev_user=dev-admin";
}

const first = shiftDate(mondayOf(today(defaultTimeZone)), 7);
let total = 0;
for (let week = 0; week < weeks; week++) {
  const date = shiftDate(first, week * 7);
  const response = await fetch(new URL("/api/seed/agenda-week", values.url), {
    method: "POST",
    headers,
    body: JSON.stringify({ date, practitionerUserId: values.practitioner }),
  });
  if (!response.ok) {
    console.error(`week of ${date} refused (${response.status}): ${await response.text()}`);
    process.exit(1);
  }
  const { booked } = (await response.json()) as { booked: number };
  total += booked;
  console.log(`week of ${date}: ${booked} booked`);
}
console.log(
  `${total} appointments booked; the agenda's busy room is "Consultorio 1" of "Sede Belgrano"`,
);
