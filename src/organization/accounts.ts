import { createClerkClient } from "@clerk/backend";
import { isClerkAPIResponseError } from "@clerk/backend/errors";

import type { Role } from "#/lib/access.ts";

// The sign-in provider's side of staff management: the one small adapter over
// Clerk's Backend API (ADR-0009). The organization's object calls it; its
// tests fake it. Without a Clerk secret (a fresh clone, the browser suite)
// the object uses the local accounts below, which keep no passwords.

/** What a member's Clerk user carries in its public metadata; the session token's claims. */
export interface AccountMetadata {
  organizationId: string;
  roles: readonly Role[];
  /** The member must replace their starting password before anything else. */
  mustChangePassword: boolean;
}

export type PasswordRefusal = "passwordTooShort" | "passwordTooLong" | "passwordRejected";

export type CreateUserResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "emailTaken" | PasswordRefusal };

export type SetPasswordResult = { ok: true } | { ok: false; reason: PasswordRefusal };

export interface NewUser {
  name: string;
  email: string;
  password: string;
  metadata: AccountMetadata;
}

export interface Accounts {
  createUser(user: NewUser): Promise<CreateUserResult>;
  /** Merges `metadata` into the user's public metadata. */
  updateMetadata(userId: string, metadata: Partial<AccountMetadata>): Promise<void>;
  setPassword(userId: string, password: string): Promise<SetPasswordResult>;
  verifyPassword(userId: string, password: string): Promise<boolean>;
  /** Bans the user, which also ends every session they have. */
  ban(userId: string): Promise<void>;
  unban(userId: string): Promise<void>;
}

/** The accounts the object's environment provides: Clerk's with a secret, the local ones otherwise. */
export function accountsFor(env: { CLERK_SECRET_KEY?: string }): Accounts {
  return env.CLERK_SECRET_KEY ? clerkAccounts(env.CLERK_SECRET_KEY) : localAccounts;
}

const passwordErrors: Record<string, PasswordRefusal> = {
  form_password_length_too_short: "passwordTooShort",
  form_password_size_in_bytes_exceeded: "passwordTooLong",
  form_password_length_too_long: "passwordTooLong",
  form_password_pwned: "passwordRejected",
  form_password_not_strong_enough: "passwordRejected",
  form_password_validation_failed: "passwordRejected",
};

/** The refusal a Clerk API error stands for, or `undefined` for one that is a failure. */
function refusalOf(error: unknown): "emailTaken" | PasswordRefusal | undefined {
  if (!isClerkAPIResponseError(error)) {
    return undefined;
  }
  for (const { code } of error.errors) {
    if (code === "form_identifier_exists") {
      return "emailTaken";
    }
    if (code in passwordErrors) {
      return passwordErrors[code];
    }
  }
  return undefined;
}

function clerkAccounts(secretKey: string): Accounts {
  const users = createClerkClient({ secretKey }).users;
  return {
    async createUser({ name, email, password, metadata }) {
      try {
        const user = await users.createUser({
          emailAddress: [email],
          password,
          firstName: name,
          publicMetadata: { ...metadata },
        });
        return { ok: true, userId: user.id };
      } catch (error) {
        const reason = refusalOf(error);
        if (reason) {
          return { ok: false, reason };
        }
        throw error;
      }
    },
    async updateMetadata(userId, metadata) {
      await users.updateUserMetadata(userId, { publicMetadata: { ...metadata } });
    },
    async setPassword(userId, password) {
      try {
        await users.updateUser(userId, { password, signOutOfOtherSessions: false });
        return { ok: true };
      } catch (error) {
        const reason = refusalOf(error);
        if (reason && reason !== "emailTaken") {
          return { ok: false, reason };
        }
        throw error;
      }
    },
    async verifyPassword(userId, password) {
      try {
        const { verified } = await users.verifyPassword({ userId, password });
        return verified;
      } catch (error) {
        // A wrong password answers 422; anything else is a failure.
        if (isClerkAPIResponseError(error) && error.status === 422) {
          return false;
        }
        throw error;
      }
    },
    async ban(userId) {
      await users.banUser(userId);
    },
    async unban(userId) {
      await users.unbanUser(userId);
    },
  };
}

/**
 * Accounts with no sign-in provider behind them, for the dev sign-in: a new
 * member gets a fresh user id, any password is accepted, and a ban is the
 * member table's active flag alone, which the dev sign-in already checks.
 */
const localAccounts: Accounts = {
  createUser: () => Promise.resolve({ ok: true, userId: `local-${crypto.randomUUID()}` }),
  updateMetadata: () => Promise.resolve(),
  setPassword: () => Promise.resolve({ ok: true }),
  verifyPassword: () => Promise.resolve(true),
  ban: () => Promise.resolve(),
  unban: () => Promise.resolve(),
};
