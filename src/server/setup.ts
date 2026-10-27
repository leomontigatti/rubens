import type { Auth } from "#/lib/auth.ts";

import { createAccount } from "./accounts.ts";
import type { CreateAccountResult } from "./accounts.ts";

export interface SetupInput {
  organizationName: string;
  adminName: string;
  adminEmail: string;
  password: string;
}

export type SetupResult =
  | { ok: true; organizationId: string; userId: string }
  | {
      ok: false;
      reason: "organizationExists" | Extract<CreateAccountResult, { ok: false }>["reason"];
    };

/**
 * Creates an organization and its first admin, the only way a business comes
 * to exist: there is no public sign-up. Idempotent per organization slug, so a
 * second run for the same name changes nothing.
 */
export async function setupOrganization(auth: Auth, input: SetupInput): Promise<SetupResult> {
  const context = await auth.$context;
  const slug = slugify(input.organizationName);
  const existing = await context.adapter.findOne({
    model: "organization",
    where: [{ field: "slug", value: slug }],
  });
  if (existing) {
    return { ok: false, reason: "organizationExists" };
  }

  const account = await createAccount(auth, {
    name: input.adminName,
    email: input.adminEmail,
    password: input.password,
  });
  if (!account.ok) {
    return account;
  }

  // Called without a session, with the creator's id: Better Auth treats it as
  // a server action, so `allowUserToCreateOrganization: false` does not refuse
  // it, and the creator becomes a member with `creatorRole`, `admin`.
  const organization = await auth.api.createOrganization({
    body: { name: input.organizationName, slug, userId: account.userId },
  });
  return { ok: true, organizationId: organization.id, userId: account.userId };
}

/** `Consultorios Belgrano` becomes `consultorios-belgrano`; accents are dropped. */
function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
