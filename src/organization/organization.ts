import { DurableObject } from "cloudflare:workers";

import { migrateDatabase, openDatabase } from "#/organization/database.ts";
import type { Database } from "#/organization/database.ts";
import {
  authorize,
  insertMember,
  listActiveMembers,
  setUpOrganization,
  viewerOf,
} from "#/organization/members.ts";
import type { Caller, MemberInput, Refusal, Requirement, Acting } from "#/organization/members.ts";

/**
 * One organization's data, in its own SQLite-backed Durable Object (ADR-0008):
 * the tenant boundary. The Worker reaches it only through the organization id
 * of a verified session (`src/server/caller.ts`), so nothing here can read or
 * write another organization's rows.
 *
 * One RPC method per operation the app performs. Each takes the caller and
 * the input, authorizes the caller against the member table, and returns a
 * result: a refusal is `{ ok: false, reason }`, never a throw. The logic lives
 * in one module per area beside this file; a method only names its
 * requirement and calls it. The object runs one event at a time, and a
 * module's checks and writes are synchronous, so a check holds until its write.
 */
export class Organization extends DurableObject {
  readonly #database: Database;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.#database = openDatabase(ctx.storage);
    void ctx.blockConcurrencyWhile(() => migrateDatabase(this.#database));
  }

  #as<T>(
    caller: Caller,
    requirement: Requirement,
    work: (acting: Acting) => T,
  ): T | { ok: false; reason: Refusal } {
    const authorized = authorize(this.#database, caller, requirement);
    return authorized.ok ? work(authorized.acting) : authorized;
  }

  // Setup and sign-in: called by the Worker before any member is signed in,
  // never with input from the browser (`src/server/organization-setup.ts`,
  // `src/server/dev-sign-in.ts`).

  setUp(input: { organizationId: string; name: string; admin: Omit<MemberInput, "roles"> }) {
    return setUpOrganization(this.#database, input);
  }

  activeMembers() {
    return listActiveMembers(this.#database);
  }

  // Members

  viewer(caller: Caller) {
    return this.#as(caller, "any", (acting) => ({
      ok: true as const,
      viewer: viewerOf(this.#database, acting),
    }));
  }

  addMember(caller: Caller, input: MemberInput) {
    return this.#as(caller, ["admin"], (acting) =>
      this.#database.transaction((tx) => insertMember(tx, acting.userId, input)),
    );
  }
}
