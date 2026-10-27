import { parseRoles } from "#/lib/access.ts";
import type { Actor, Role } from "#/lib/access.ts";
import type { Auth } from "#/lib/auth.ts";

/**
 * What a server function needs from its caller: one of `roles`, or any role.
 * Only the call that replaces the starting password sets `passwordChange`.
 */
export interface Requirement {
  roles: "any" | readonly Role[];
  passwordChange?: "allowed";
}

export type Refusal = "unauthenticated" | "forbidden" | "mustChangePassword";

export type AuthorizeResult = { ok: true; actor: Actor } | { ok: false; reason: Refusal };

/**
 * Resolves the actor behind a signed-in user and checks `requirement`. The
 * user's organization is their membership's, not the session's active one: a
 * member belongs to exactly one organization (ADR-0002).
 */
export async function authorize(
  auth: Auth,
  userId: string | undefined,
  requirement: Requirement,
): Promise<AuthorizeResult> {
  if (!userId) {
    return { ok: false, reason: "unauthenticated" };
  }
  const context = await auth.$context;
  const [user, member] = await Promise.all([
    context.adapter.findOne<{ mustChangePassword: boolean }>({
      model: "user",
      where: [{ field: "id", value: userId }],
    }),
    context.adapter.findOne<{ organizationId: string; role: string; active: boolean }>({
      model: "member",
      where: [{ field: "userId", value: userId }],
    }),
  ]);
  // A deactivated member is treated as signed out: deactivation already ended
  // their sessions, so this only catches a request already in flight.
  if (!user || !member || !member.active) {
    return { ok: false, reason: "unauthenticated" };
  }
  if (user.mustChangePassword && requirement.passwordChange !== "allowed") {
    return { ok: false, reason: "mustChangePassword" };
  }

  const actor: Actor = {
    organizationId: member.organizationId,
    userId,
    roles: parseRoles(member.role),
  };
  const required = requirement.roles;
  if (required !== "any" && !actor.roles.some((role) => required.includes(role))) {
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true, actor };
}
