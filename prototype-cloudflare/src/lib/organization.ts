import { env } from "./identity";

/**
 * The organization's Durable Object. `locationHint: "sam"` asks for South America;
 * Cloudflare runs SQLite-backed objects hinted there in the US East today. The hint
 * applies only when the object is first created.
 */
export function organizationObject(organizationId: string) {
  return env.ORGANIZATION.get(env.ORGANIZATION.idFromName(organizationId), { locationHint: "sam" });
}
