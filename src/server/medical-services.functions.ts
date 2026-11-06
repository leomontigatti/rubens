import { createServerFn } from "@tanstack/react-start";

import type {
  MedicalServiceActiveChange,
  MedicalServiceInput,
  MedicalServiceUpdate,
} from "#/lib/medical-services.ts";

import type { MedicalServiceListOptions } from "#/organization/medical-services.ts";
import { withOrganization } from "#/server/with-organization.ts";

// The object validates the input and decides whose medical services the
// caller may change, so each validator here only names the type.

export const getMedicalServicePractitioners = createServerFn({ method: "GET" }).handler(() =>
  withOrganization((organization, caller) => organization.listSchedulePractitioners(caller)),
);

export const getMedicalServices = createServerFn({ method: "GET" })
  .validator((data: MedicalServiceListOptions) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.listMedicalServices(caller, data)),
  );

export const addMedicalService = createServerFn({ method: "POST" })
  .validator((data: MedicalServiceInput) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.createMedicalService(caller, data)),
  );

export const editMedicalService = createServerFn({ method: "POST" })
  .validator((data: MedicalServiceUpdate) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.updateMedicalService(caller, data)),
  );

export const changeMedicalServiceActive = createServerFn({ method: "POST" })
  .validator((data: MedicalServiceActiveChange) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.setMedicalServiceActive(caller, data)),
  );
