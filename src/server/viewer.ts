import type { Actor } from "#/lib/access.ts";
import type { Auth } from "#/lib/auth.ts";

export interface Viewer {
  name: string;
  email: string;
  organizationName: string;
  mustChangePassword: boolean;
}

/** Who is signed in, and for which organization: what the app shell shows. */
export async function loadViewer(auth: Auth, actor: Actor): Promise<Viewer> {
  const context = await auth.$context;
  const [user, organization] = await Promise.all([
    context.adapter.findOne<{ name: string; email: string; mustChangePassword: boolean }>({
      model: "user",
      where: [{ field: "id", value: actor.userId }],
    }),
    context.adapter.findOne<{ name: string }>({
      model: "organization",
      where: [{ field: "id", value: actor.organizationId }],
    }),
  ]);
  if (!user || !organization) {
    throw new Error(`viewer ${actor.userId} has no user or organization row`);
  }
  return {
    name: user.name,
    email: user.email,
    organizationName: organization.name,
    mustChangePassword: user.mustChangePassword,
  };
}
