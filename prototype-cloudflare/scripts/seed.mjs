// Seeds the running dev server (`pnpm dev`): one organization, one admin, four
// practitioners, two rooms, 20 patients and ~1,600 appointments over Oct–Dec 2026.
const base = process.env.BASE_URL ?? "http://localhost:5173";
const response = await fetch(`${base}/api/dev/seed`, { method: "POST" });
if (!response.ok) {
  console.error(`seed failed: ${response.status} ${await response.text()}`);
  console.error("Is `pnpm dev` running?");
  process.exit(1);
}
console.log(JSON.stringify(await response.json(), null, 2));
