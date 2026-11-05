import type { Caller } from "./access";
import { env, getAuth } from "./auth";

/** The session's user and organization, or null when signed out. */
export async function callerFrom(headers: Headers): Promise<Caller | null> {
  const auth = await getAuth();
  const result = await auth.api.getSession({ headers });
  const organizationId = result?.session.activeOrganizationId;
  if (!result || !organizationId) return null;
  return { userId: result.user.id, organizationId };
}

/**
 * The organization's Durable Object. `locationHint: "sam"` asks for South America;
 * Cloudflare runs SQLite-backed objects hinted there in the US East today. The hint
 * applies only when the object is first created.
 */
export function organizationObject(organizationId: string) {
  return env.ORGANIZATION.get(env.ORGANIZATION.idFromName(organizationId), { locationHint: "sam" });
}
