import type { Role } from "#/lib/access.ts";
import type { Auth } from "#/lib/auth.ts";
import { createAccount } from "#/server/accounts.ts";
import { setupOrganization } from "#/server/setup.ts";

export const startingPassword = "starting-password";

/** An organization set up as the setup script does, with its first admin. */
export async function createOrganization(auth: Auth, name = "Consultorios Belgrano") {
  const slug = name.toLowerCase().replaceAll(" ", "-");
  const result = await setupOrganization(auth, {
    organizationName: name,
    adminName: "Ana Pérez",
    adminEmail: `ana@${slug}.example.com`,
    password: startingPassword,
  });
  if (!result.ok) {
    throw new Error(`setup failed: ${result.reason}`);
  }
  return { organizationId: result.organizationId, adminUserId: result.userId };
}

/** A staff member of `organizationId` holding `roles`, with a starting password. */
export async function createMember(
  auth: Auth,
  organizationId: string,
  roles: readonly Role[],
  email = `${roles.join("-")}@example.com`,
) {
  const account = await createAccount(auth, {
    name: "Juan Gómez",
    email,
    password: startingPassword,
  });
  if (!account.ok) {
    throw new Error(`account failed: ${account.reason}`);
  }
  await auth.api.addMember({
    body: { userId: account.userId, organizationId, role: [...roles] },
  });
  return account.userId;
}

/** Clears the starting-password flag, as if the member had replaced it. */
export async function clearMustChangePassword(auth: Auth, userId: string) {
  const context = await auth.$context;
  await context.internalAdapter.updateUser(userId, { mustChangePassword: false });
}
