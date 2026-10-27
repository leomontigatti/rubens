import type { Auth } from "#/lib/auth.ts";

export interface NewAccount {
  name: string;
  email: string;
  password: string;
}

type PasswordRefusal = "passwordTooShort" | "passwordTooLong";

export type CreateAccountResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "emailTaken" | PasswordRefusal };

/**
 * Creates a user who signs in with email and password, and who must replace
 * that starting password before doing anything else.
 *
 * Better Auth's sign-up endpoint refuses because sign-up is disabled, so this
 * does what that endpoint does through Better Auth's internal adapter and
 * password hasher: the user row, then the `credential` account holding the
 * hash. The setup script creates the first admin with it, and an admin every
 * other staff member.
 */
export async function createAccount(auth: Auth, account: NewAccount): Promise<CreateAccountResult> {
  const context = await auth.$context;
  const refusal = checkPassword(context.password.config, account.password);
  if (refusal) {
    return { ok: false, reason: refusal };
  }

  const email = account.email.toLowerCase();
  if (await context.internalAdapter.findUserByEmail(email)) {
    return { ok: false, reason: "emailTaken" };
  }

  const hash = await context.password.hash(account.password);
  const user = await context.internalAdapter.createUser(
    { name: account.name, email, emailVerified: false, mustChangePassword: true },
    { method: "email-password" },
  );
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: hash,
  });
  return { ok: true, userId: user.id };
}

function checkPassword(
  config: { minPasswordLength: number; maxPasswordLength: number },
  password: string,
): PasswordRefusal | undefined {
  if (password.length < config.minPasswordLength) {
    return "passwordTooShort";
  }
  if (password.length > config.maxPasswordLength) {
    return "passwordTooLong";
  }
  return undefined;
}

export interface PasswordChange {
  currentPassword: string;
  newPassword: string;
}

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: "wrongPassword" | "samePassword" | PasswordRefusal };

/**
 * A signed-in user replaces their own password, which clears
 * `mustChangePassword`. Better Auth's own `/change-password` is disabled
 * (`src/lib/auth.ts`), so this is the only path and the flag never outlives
 * the starting password.
 */
export async function changeOwnPassword(
  auth: Auth,
  userId: string,
  change: PasswordChange,
): Promise<ChangePasswordResult> {
  const context = await auth.$context;
  const refusal = checkPassword(context.password.config, change.newPassword);
  if (refusal) {
    return { ok: false, reason: refusal };
  }
  if (change.newPassword === change.currentPassword) {
    return { ok: false, reason: "samePassword" };
  }

  const account = await context.internalAdapter.findCredentialAccount(userId);
  const matches = account?.password
    ? await context.password.verify({ hash: account.password, password: change.currentPassword })
    : false;
  if (!matches) {
    return { ok: false, reason: "wrongPassword" };
  }

  await context.internalAdapter.updatePassword(
    userId,
    await context.password.hash(change.newPassword),
  );
  await context.internalAdapter.updateUser(userId, { mustChangePassword: false });
  return { ok: true };
}
