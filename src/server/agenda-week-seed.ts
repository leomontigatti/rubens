import * as z from "zod";

import { authMode, clerkSession, resolveCaller } from "#/server/caller.ts";
import type { WorkerEnv } from "#/server/caller.ts";
import { sameSecret } from "#/server/organization-setup.ts";

// Serves the busy week the agenda's CPU is measured on (#139,
// `src/dev/agenda-week.ts`): in dev mode to anyone signed in, and with a Clerk
// secret only to a request carrying SEED_SECRET in `x-seed-secret`; a Worker
// with neither answers 404. The caller comes from the request's session, as
// for any other call, and the object books only for an admin.

const seedSchema = z.object({
  date: z.iso.date(),
  practitionerUserId: z.string().min(1).optional(),
});

/** A refusal unless the request carries the Worker's SEED_SECRET; 404 when it has none. */
async function checkSeedSecret(request: Request, env: WorkerEnv): Promise<Response | null> {
  if (!env.SEED_SECRET) {
    return new Response(null, { status: 404 });
  }
  const given = request.headers.get("x-seed-secret") ?? "";
  return (await sameSecret(given, env.SEED_SECRET)) ? null : new Response(null, { status: 401 });
}

/** Serves `POST /api/seed/agenda-week`: books one week, `scripts/seed-agenda-week.ts` runs it per week. */
export async function handleAgendaWeekSeed(
  request: Request,
  env: WorkerEnv,
  devServer: boolean,
): Promise<Response> {
  const mode = authMode(env, devServer);
  const refusal = mode === "clerk" ? await checkSeedSecret(request, env) : null;
  if (refusal) {
    return refusal;
  }
  const resolved = await resolveCaller(request, env, mode, clerkSession(env));
  if (!resolved.ok) {
    return Response.json(resolved, { status: 401 });
  }
  const parsed = seedSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, reason: "invalidInput" }, { status: 400 });
  }
  const result = await resolved.organization.seedAgendaWeek(resolved.caller, parsed.data);
  return Response.json(result, { status: result.ok ? 200 : 403 });
}
