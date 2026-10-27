import { getRequestHeaders } from "@tanstack/react-start/server";

import type { Actor } from "#/lib/access.ts";
import { auth } from "#/lib/auth.ts";

import { authorize } from "#/server/actor.ts";
import type { Refusal, Requirement } from "#/server/actor.ts";

/**
 * The shared step in front of every server function: resolves the actor from
 * the request's session, refuses the caller as `authorize` says, and otherwise
 * runs `work`. A refusal is a result the caller maps to copy, never a throw.
 */
export async function withActor<T>(
  requirement: Requirement,
  work: (actor: Actor) => Promise<T>,
): Promise<T | { ok: false; reason: Refusal }> {
  const session = await auth.api.getSession({ headers: getRequestHeaders() });
  const result = await authorize(auth, session?.user.id, requirement);
  if (!result.ok) {
    return result;
  }
  return work(result.actor);
}
