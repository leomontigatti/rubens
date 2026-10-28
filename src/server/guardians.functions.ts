import { createServerFn } from "@tanstack/react-start";

import type {
  GuardianId,
  GuardianInput,
  GuardianUpdate,
  MessageContactChange,
} from "#/lib/guardians.ts";

import {
  addGuardian,
  listGuardians,
  removeGuardian,
  setMessageContact,
  updateGuardian,
} from "#/server/guardians.ts";
import { withActor } from "#/server/with-actor.ts";

// The services validate their input and check the actor's roles themselves, so
// each validator here only names the type. Naming the roles here as well
// refuses a call before it opens a transaction.
const editors = { roles: ["admin", "receptionist", "practitioner"] } as const;

export const getGuardians = createServerFn({ method: "GET" })
  .validator((data: { patientId: string }) => data)
  .handler(({ data }) => withActor(editors, (actor) => listGuardians(actor, data)));

export const addPatientGuardian = createServerFn({ method: "POST" })
  .validator((data: GuardianInput) => data)
  .handler(({ data }) => withActor(editors, (actor) => addGuardian(actor, data)));

export const editGuardian = createServerFn({ method: "POST" })
  .validator((data: GuardianUpdate) => data)
  .handler(({ data }) => withActor(editors, (actor) => updateGuardian(actor, data)));

export const deleteGuardian = createServerFn({ method: "POST" })
  .validator((data: GuardianId) => data)
  .handler(({ data }) => withActor(editors, (actor) => removeGuardian(actor, data)));

export const changeMessageContact = createServerFn({ method: "POST" })
  .validator((data: MessageContactChange) => data)
  .handler(({ data }) => withActor(editors, (actor) => setMessageContact(actor, data)));
