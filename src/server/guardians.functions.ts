import { createServerFn } from "@tanstack/react-start";

import type {
  GuardianId,
  GuardianInput,
  GuardianUpdate,
  MessageContactChange,
} from "#/lib/guardians.ts";

import { withOrganization } from "#/server/with-organization.ts";

// The object validates the input and requires the roles for each call, so
// each validator here only names the type.

export const getGuardians = createServerFn({ method: "GET" })
  .validator((data: { patientId: string }) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.listGuardians(caller, data)),
  );

export const addPatientGuardian = createServerFn({ method: "POST" })
  .validator((data: GuardianInput) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.addGuardian(caller, data)),
  );

export const editGuardian = createServerFn({ method: "POST" })
  .validator((data: GuardianUpdate) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.updateGuardian(caller, data)),
  );

export const deleteGuardian = createServerFn({ method: "POST" })
  .validator((data: GuardianId) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.removeGuardian(caller, data)),
  );

export const changeMessageContact = createServerFn({ method: "POST" })
  .validator((data: MessageContactChange) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.setMessageContact(caller, data)),
  );
