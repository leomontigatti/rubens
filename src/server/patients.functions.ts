import { createServerFn } from "@tanstack/react-start";

import type {
  DuplicateConfirmation,
  PatientActiveChange,
  PatientReference,
  PatientInput,
  PatientUpdate,
  WhatsappConsentChange,
} from "#/lib/patients.ts";

import type { SearchOptions } from "#/organization/patient-search.ts";
import type { PatientListOptions } from "#/organization/patients.ts";
import { withOrganization } from "#/server/with-organization.ts";

// The object validates the input and requires the roles for each call, so
// each validator here only names the type.

export const getPatients = createServerFn({ method: "GET" })
  .validator((data: PatientListOptions) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.listPatients(caller, data)),
  );

// A POST, so the search text travels in the body and stays out of URLs.
export const findPatients = createServerFn({ method: "POST" })
  .validator((data: SearchOptions) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.searchPatients(caller, data)),
  );

export const getPatientDetails = createServerFn({ method: "GET" })
  .validator((data: { patientId: string }) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.getPatient(caller, data)),
  );

export const getPatientChanges = createServerFn({ method: "GET" })
  .validator((data: { patientId: string }) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.getPatientHistory(caller, data)),
  );

export const addPatient = createServerFn({ method: "POST" })
  .validator((data: PatientInput & DuplicateConfirmation) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.registerPatient(caller, data)),
  );

export const editPatient = createServerFn({ method: "POST" })
  .validator((data: PatientUpdate & DuplicateConfirmation) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.updatePatient(caller, data)),
  );

export const changeWhatsappConsent = createServerFn({ method: "POST" })
  .validator((data: WhatsappConsentChange) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.setWhatsappConsent(caller, data)),
  );

// Until appointments port (#137, #138), deactivating a patient sends nothing
// to the to-reschedule list, so the count is 0.
export const getPatientUpcomingCount = createServerFn({ method: "GET" })
  .validator((data: PatientReference) => data)
  .handler(() => ({ ok: true as const, count: 0 }));

export const changePatientActive = createServerFn({ method: "POST" })
  .validator((data: PatientActiveChange) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.setPatientActive(caller, data)),
  );
