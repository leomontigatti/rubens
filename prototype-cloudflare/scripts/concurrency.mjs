// Check 2: fires N concurrent bookings at the running dev server and counts what was saved.
//   node scripts/concurrency.mjs practitioner   -> one practitioner, overlapping spans, rooms alternating
//   node scripts/concurrency.mjs room           -> one room, four practitioners, overlapping spans
//   node scripts/concurrency.mjs room-overbooking -> as room, every request an overbooking
const base = process.env.BASE_URL ?? "http://localhost:5173";
const mode = process.argv[2] ?? "practitioner";
const n = Number(process.argv[3] ?? 50);
const day = { practitioner: "2027-01-04", room: "2027-01-05", "room-overbooking": "2027-01-06" }[
  mode
];

// With Clerk, pass an admin's session token (CLERK_TOKEN, from `await Clerk.session.getToken()`
// in a signed-in browser); in dev mode, sign in as the seeded admin.
let auth;
if (process.env.CLERK_TOKEN) {
  auth = { authorization: `Bearer ${process.env.CLERK_TOKEN}` };
} else {
  const signIn = await fetch(`${base}/api/dev/sign-in`, {
    method: "POST",
    body: new URLSearchParams({ userId: "user_dev_admin" }),
    redirect: "manual",
  });
  auth = { cookie: signIn.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}

// Every span is 60 minutes and starts within 49 minutes of 10:00, so each pair overlaps.
const startOf = (k) => Date.parse(`${day}T10:00:00-03:00`) + k * 60_000;
const requests = Array.from({ length: n }, (_, k) => {
  const body =
    mode === "practitioner"
      ? { practitionerId: "practitioner-1", roomId: k % 2 ? "room-1" : "room-2" }
      : {
          practitionerId: `practitioner-${(k % 4) + 1}`,
          roomId: "room-2",
          overbooking: mode === "room-overbooking",
        };
  return fetch(`${base}/api/appointments`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      ...body,
      patientId: `patient-${String((k % 20) + 1).padStart(2, "0")}`,
      startsAt: startOf(k),
      endsAt: startOf(k) + 3_600_000,
    }),
  }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
});
const started = performance.now();
const results = await Promise.all(requests);
const elapsed = performance.now() - started;
const tally = {};
for (const r of results) {
  const key = r.ok
    ? `saved (${r.status})`
    : `refused ${r.reason}/${r.constraint ?? "-"} (${r.status})`;
  tally[key] = (tally[key] ?? 0) + 1;
}
const savedBy = {};
for (const [k, r] of results.entries())
  if (r.ok)
    savedBy[mode === "practitioner" ? "practitioner-1" : `practitioner-${(k % 4) + 1}`] =
      (savedBy[mode === "practitioner" ? "practitioner-1" : `practitioner-${(k % 4) + 1}`] ?? 0) +
      1;
console.log(
  JSON.stringify({ mode, day, requests: n, wallMs: Math.round(elapsed), tally, savedBy }, null, 2),
);
