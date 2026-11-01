import type { Role } from "#/lib/access.ts";
import type { Auth } from "#/lib/auth.ts";
import { createAccount } from "#/server/accounts.ts";
import { setupOrganization } from "#/server/setup.ts";

export const startingPassword = "starting-password";

/**
 * A user as `createAccount` leaves them, without the credential account. Hashing
 * a password costs about 0.2 s, most of what a scheduling test takes, so only a
 * test that signs in or changes a password pays for it (`*WithPassword` below).
 */
export async function createUserWithoutPassword(
  auth: Auth,
  { name, email }: { name: string; email: string },
) {
  const context = await auth.$context;
  return context.internalAdapter.createUser(
    { name, email, emailVerified: false, mustChangePassword: true },
    { method: "email-password" },
  );
}

const adminName = "Ana Pérez";
const slugOf = (name: string) => name.toLowerCase().replaceAll(" ", "-");
const adminEmailOf = (slug: string) => `ana@${slug}.example.com`;

/** An organization with its first admin, who has no password. */
export async function createOrganization(auth: Auth, name = "Consultorios Belgrano") {
  const slug = slugOf(name);
  const admin = await createUserWithoutPassword(auth, {
    name: adminName,
    email: adminEmailOf(slug),
  });
  const organization = await auth.api.createOrganization({
    body: { name, slug, userId: admin.id },
  });
  return { organizationId: organization.id, adminUserId: admin.id };
}

/** An organization set up as the setup script does, with its first admin. */
export async function createOrganizationWithPassword(auth: Auth, name = "Consultorios Belgrano") {
  const result = await setupOrganization(auth, {
    organizationName: name,
    adminName,
    adminEmail: adminEmailOf(slugOf(name)),
    password: startingPassword,
  });
  if (!result.ok) {
    throw new Error(`setup failed: ${result.reason}`);
  }
  return { organizationId: result.organizationId, adminUserId: result.userId };
}

/** A staff member of `organizationId` holding `roles`, without a password. */
export async function createMember(
  auth: Auth,
  organizationId: string,
  roles: readonly Role[],
  email = `${roles.join("-")}@example.com`,
) {
  const user = await createUserWithoutPassword(auth, { name: "Juan Gómez", email });
  await auth.api.addMember({
    body: { userId: user.id, organizationId, role: [...roles] },
  });
  return user.id;
}

/** A staff member of `organizationId` holding `roles`, with a starting password. */
export async function createMemberWithPassword(
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
