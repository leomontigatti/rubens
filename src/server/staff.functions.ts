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

export const getMemberUpcomingCount = createServerFn({ method: "GET" })
  .validator((data: MemberReference) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.countMemberUpcoming(caller, data)),
  );

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
