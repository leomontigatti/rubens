import { timingSafeEqual } from "node:crypto";

import * as z from "zod";

import { organizationObject } from "#/server/caller.ts";
import type { WorkerEnv } from "#/server/caller.ts";

// How an organization comes to exist: there is no public sign-up. The setup
// script (`scripts/setup-organization.ts`) posts here with the Worker's
// SETUP_SECRET; the organization's object creates its first admin, in Clerk
// and in its member table. A Worker with no SETUP_SECRET does not serve it.

const setupSchema = z.object({
  organizationName: z.string().trim().min(1).max(200),
  adminName: z.string().trim().min(1).max(200),
  adminEmail: z.email().trim(),
  password: z.string(),
});

/** `Consultorios Belgrano` becomes `consultorios-belgrano`; accents are dropped. */
function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Whether `given` is `expected`, compared in constant time. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const digest = (value: string) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}

/**
 * Serves `POST /api/setup`. The organization's id is its name's slug, so a
 * second run for the same name reaches the same object, which changes nothing
 * and says so.
 */
export async function handleSetupRequest(request: Request, env: WorkerEnv): Promise<Response> {
  if (!env.SETUP_SECRET) {
    return new Response(null, { status: 404 });
  }
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!(await sameSecret(token, env.SETUP_SECRET))) {
    return new Response(null, { status: 401 });
  }
  const parsed = setupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, reason: "invalidInput" }, { status: 400 });
  }
  const { organizationName, adminName, adminEmail, password } = parsed.data;
  const organizationId = slugify(organizationName);
  if (!organizationId) {
    return Response.json({ ok: false, reason: "invalidOrganizationName" }, { status: 400 });
  }
  const result = await organizationObject(env, organizationId).setUpWithAccount({
    organizationId,
    name: organizationName,
    admin: { name: adminName, email: adminEmail, password },
  });
  return Response.json(result.ok ? { ok: true, organizationId, userId: result.userId } : result, {
    status: result.ok ? 201 : 409,
  });
}
