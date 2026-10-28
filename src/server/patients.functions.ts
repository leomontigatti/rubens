import { createServerFn } from "@tanstack/react-start";

import type {
  DuplicateConfirmation,
  PatientActiveChange,
  PatientInput,
  PatientUpdate,
  WhatsappConsentChange,
} from "#/lib/patients.ts";

import {
  getPatient,
  getPatientHistory,
  listPatients,
  registerPatient,
  searchPatients,
  setPatientActive,
  setWhatsappConsent,
  updatePatient,
} from "#/server/patients.ts";
import type { ListOptions, SearchOptions } from "#/server/patients.ts";
import { withActor } from "#/server/with-actor.ts";

// The services validate their input and check the actor's roles themselves, so
// each validator here only names the type. Naming the roles here as well
// refuses a call before it opens a transaction.
const editors = { roles: ["admin", "receptionist", "practitioner"] } as const;
const adminOnly = { roles: ["admin"] } as const;

export const getPatients = createServerFn({ method: "GET" })
  .validator((data: ListOptions) => data)
  .handler(({ data }) =>
    withActor(editors, (actor) => listPatients(actor, { includeInactive: data.includeInactive })),
  );

export const findPatients = createServerFn({ method: "GET" })
  .validator((data: SearchOptions) => data)
  .handler(({ data }) => withActor(editors, (actor) => searchPatients(actor, data)));

export const getPatientDetails = createServerFn({ method: "GET" })
  .validator((data: { patientId: string }) => data)
  .handler(({ data }) => withActor(editors, (actor) => getPatient(actor, data)));

export const getPatientChanges = createServerFn({ method: "GET" })
  .validator((data: { patientId: string }) => data)
  .handler(({ data }) => withActor(adminOnly, (actor) => getPatientHistory(actor, data)));

export const addPatient = createServerFn({ method: "POST" })
  .validator((data: PatientInput & DuplicateConfirmation) => data)
  .handler(({ data }) => withActor(editors, (actor) => registerPatient(actor, data)));

export const editPatient = createServerFn({ method: "POST" })
  .validator((data: PatientUpdate & DuplicateConfirmation) => data)
  .handler(({ data }) => withActor(editors, (actor) => updatePatient(actor, data)));

export const changeWhatsappConsent = createServerFn({ method: "POST" })
  .validator((data: WhatsappConsentChange) => data)
  .handler(({ data }) => withActor(editors, (actor) => setWhatsappConsent(actor, data)));

export const changePatientActive = createServerFn({ method: "POST" })
  .validator((data: PatientActiveChange) => data)
  .handler(({ data }) => withActor(adminOnly, (actor) => setPatientActive(actor, data)));
