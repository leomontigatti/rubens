import { createServerFn } from "@tanstack/react-start";

import type {
  MemberActiveChange,
  PractitionerUpdate,
  RolesChange,
  StaffInput,
  StartingPasswordChange,
} from "#/lib/staff.ts";

import {
  changeRoles,
  createStaffMember,
  getStaffMember,
  listStaff,
  setMemberActive,
  setStartingPassword,
  updatePractitioner,
} from "./staff.ts";
import { withActor } from "./with-actor.ts";

// The services validate their input and refuse non-admins themselves, so each
// validator here only names the type. Requiring the admin role as well refuses
// a call before it opens a transaction.
const adminOnly = { roles: ["admin"] } as const;

export const getStaff = createServerFn({ method: "GET" }).handler(() =>
  withActor(adminOnly, (actor) => listStaff(actor)),
);

export const getMember = createServerFn({ method: "GET" })
  .validator((data: { memberId: string }) => data)
  .handler(({ data }) => withActor(adminOnly, (actor) => getStaffMember(actor, data)));

export const addStaffMember = createServerFn({ method: "POST" })
  .validator((data: StaffInput) => data)
  .handler(({ data }) => withActor(adminOnly, (actor) => createStaffMember(actor, data)));

export const editRoles = createServerFn({ method: "POST" })
  .validator((data: RolesChange) => data)
  .handler(({ data }) => withActor(adminOnly, (actor) => changeRoles(actor, data)));

export const editPractitioner = createServerFn({ method: "POST" })
  .validator((data: PractitionerUpdate) => data)
  .handler(({ data }) => withActor(adminOnly, (actor) => updatePractitioner(actor, data)));

export const changeMemberActive = createServerFn({ method: "POST" })
  .validator((data: MemberActiveChange) => data)
  .handler(({ data }) => withActor(adminOnly, (actor) => setMemberActive(actor, data)));

export const resetStartingPassword = createServerFn({ method: "POST" })
  .validator((data: StartingPasswordChange) => data)
  .handler(({ data }) => withActor(adminOnly, (actor) => setStartingPassword(actor, data)));
