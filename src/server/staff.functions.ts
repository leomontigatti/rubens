import { createServerFn } from "@tanstack/react-start";

import type {
  MemberActiveChange,
  MemberReference,
  MemberUpdate,
  StaffInput,
  StartingPasswordChange,
} from "#/lib/staff.ts";

import { withOrganization } from "#/server/with-organization.ts";

// The organization's object validates the input and refuses non-admins
// itself, so each validator here only names the type.

export const getStaff = createServerFn({ method: "GET" }).handler(() =>
  withOrganization((organization, caller) => organization.listStaff(caller)),
);

export const getMember = createServerFn({ method: "GET" })
  .validator((data: { memberId: string }) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.getStaffMember(caller, data)),
  );

export const addStaffMember = createServerFn({ method: "POST" })
  .validator((data: StaffInput) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.createStaffMember(caller, data)),
  );

export const editMember = createServerFn({ method: "POST" })
  .validator((data: MemberUpdate) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.updateMember(caller, data)),
  );

/**
 * How many future appointments deactivating the member sends to the
 * to-reschedule list. That list returns with the object's (#138); until then
 * the answer is a refusal, and the deactivation asks nothing first.
 */
export const getMemberUpcomingCount = createServerFn({ method: "GET" })
  .validator((data: MemberReference) => data)
  .handler(() => ({ ok: false as const, reason: "notAvailable" as const }));

export const changeMemberActive = createServerFn({ method: "POST" })
  .validator((data: MemberActiveChange) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.setMemberActive(caller, data)),
  );

export const resetStartingPassword = createServerFn({ method: "POST" })
  .validator((data: StartingPasswordChange) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.setStartingPassword(caller, data)),
  );
