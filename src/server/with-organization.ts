import { getRequest } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";

import type { Caller } from "#/organization/members.ts";
import type { Organization } from "#/organization/organization.ts";
import { authMode, clerkSession, resolveCaller } from "#/server/caller.ts";
import type { WorkerEnv } from "#/server/caller.ts";

export const workerEnv = env as unknown as WorkerEnv;

/** Which sign-in this Worker serves (`authMode`). */
export function currentAuthMode() {
  return authMode(workerEnv, import.meta.env.DEV);
}

/**
 * An RPC result as a server function returns it: RPC adds `Symbol.dispose` to
 * every object it returns, which is the stub's handle, not data.
 */
type Data<T> = T extends Disposable ? Omit<T, typeof Symbol.dispose> : T;

/**
 * The shared step in front of every server function: resolves the caller and
 * their organization's object from the request's session, and runs `work`
 * with them. The object authorizes the caller itself; a request with no
 * session is refused here. A refusal is a result, never a throw.
 */
export async function withOrganization<T>(
  work: (organization: DurableObjectStub<Organization>, caller: Caller) => Promise<T>,
): Promise<Data<T> | { ok: false; reason: "unauthenticated" }> {
  const mode = currentAuthMode();
  const resolved = await resolveCaller(getRequest(), workerEnv, mode, clerkSession(workerEnv));
  if (!resolved.ok) {
    return resolved;
  }
  return (await work(resolved.organization, resolved.caller)) as Data<T>;
}
