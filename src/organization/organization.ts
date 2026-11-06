import { DurableObject } from "cloudflare:workers";

import type { InsurerActiveChange, InsurerInput, InsurerUpdate } from "#/lib/coverages.ts";
import type {
  MedicalServiceActiveChange,
  MedicalServiceInput,
  MedicalServiceUpdate,
} from "#/lib/medical-services.ts";
import type {
  ActiveChange,
  OfficeInput,
  OfficeUpdate,
  RoomInput,
  RoomUpdate,
} from "#/lib/offices.ts";

import { migrateDatabase, openDatabase } from "#/organization/database.ts";
import type { Database } from "#/organization/database.ts";
import {
  createInsurer,
  listInsurers,
  setInsurerActive,
  updateInsurer,
} from "#/organization/insurers.ts";
import type { InsurerListOptions } from "#/organization/insurers.ts";
import {
  createMedicalService,
  listMedicalServices,
  setMedicalServiceActive,
  updateMedicalService,
} from "#/organization/medical-services.ts";
import type { MedicalServiceListOptions } from "#/organization/medical-services.ts";
import {
  authorize,
  insertMember,
  listActiveMembers,
  setUpOrganization,
  viewerOf,
} from "#/organization/members.ts";
import type { Caller, MemberInput, Refusal, Requirement, Acting } from "#/organization/members.ts";
import {
  createOffice,
  createRoom,
  getOffice,
  listOffices,
  setOfficeActive,
  setRoomActive,
  updateOffice,
  updateRoom,
} from "#/organization/offices.ts";
import type { ListOptions } from "#/organization/offices.ts";
import { listSchedulePractitioners } from "#/organization/practitioners.ts";

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
// A practitioner changes their own medical services; which ones are theirs is
// the area's to decide (`src/organization/medical-services.ts`).
const medicalServiceEditors = ["admin", "practitioner"] as const;

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

  // Offices and rooms

  listOffices(caller: Caller, input: ListOptions) {
    return this.#as(caller, "any", () => listOffices(this.#database, input));
  }

  getOffice(caller: Caller, input: { officeId: string } & ListOptions) {
    return this.#as(caller, "any", () => getOffice(this.#database, input));
  }

  createOffice(caller: Caller, input: OfficeInput) {
    return this.#as(caller, ["admin"], (acting) => createOffice(this.#database, acting, input));
  }

  updateOffice(caller: Caller, input: OfficeUpdate) {
    return this.#as(caller, ["admin"], (acting) => updateOffice(this.#database, acting, input));
  }

  setOfficeActive(caller: Caller, input: ActiveChange) {
    return this.#as(caller, ["admin"], (acting) => setOfficeActive(this.#database, acting, input));
  }

  createRoom(caller: Caller, input: RoomInput) {
    return this.#as(caller, ["admin"], (acting) => createRoom(this.#database, acting, input));
  }

  updateRoom(caller: Caller, input: RoomUpdate) {
    return this.#as(caller, ["admin"], (acting) => updateRoom(this.#database, acting, input));
  }

  setRoomActive(caller: Caller, input: ActiveChange) {
    return this.#as(caller, ["admin"], (acting) => setRoomActive(this.#database, acting, input));
  }

  // Medical services

  listSchedulePractitioners(caller: Caller) {
    return this.#as(caller, "any", () => listSchedulePractitioners(this.#database));
  }

  listMedicalServices(caller: Caller, input: MedicalServiceListOptions) {
    return this.#as(caller, "any", (acting) => listMedicalServices(this.#database, acting, input));
  }

  createMedicalService(caller: Caller, input: MedicalServiceInput) {
    return this.#as(caller, medicalServiceEditors, (acting) =>
      createMedicalService(this.#database, acting, input),
    );
  }

  updateMedicalService(caller: Caller, input: MedicalServiceUpdate) {
    return this.#as(caller, medicalServiceEditors, (acting) =>
      updateMedicalService(this.#database, acting, input),
    );
  }

  setMedicalServiceActive(caller: Caller, input: MedicalServiceActiveChange) {
    return this.#as(caller, medicalServiceEditors, (acting) =>
      setMedicalServiceActive(this.#database, acting, input),
    );
  }

  // Insurers

  listInsurers(caller: Caller, input: InsurerListOptions) {
    return this.#as(caller, "any", () => listInsurers(this.#database, input));
  }

  createInsurer(caller: Caller, input: InsurerInput) {
    return this.#as(caller, ["admin"], (acting) => createInsurer(this.#database, acting, input));
  }

  updateInsurer(caller: Caller, input: InsurerUpdate) {
    return this.#as(caller, ["admin"], (acting) => updateInsurer(this.#database, acting, input));
  }

  setInsurerActive(caller: Caller, input: InsurerActiveChange) {
    return this.#as(caller, ["admin"], (acting) => setInsurerActive(this.#database, acting, input));
  }
}
