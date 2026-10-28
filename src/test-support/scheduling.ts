import type { Actor, Role } from "#/lib/access.ts";
import { createAuth } from "#/lib/auth.ts";
import { createOrganization, startingPassword } from "#/test-support/organization.ts";

import { asAppRole } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { createOffice, createRoom } from "#/server/offices.ts";
import { createStaffMember } from "#/server/staff.ts";

/**
 * An organization with its admin, ready for scheduling: offices, rooms and
 * staff are added through the services, as the app role.
 */
export async function createSchedulingWorld(db: TestDatabase) {
  const auth = createAuth(db);
  const { organizationId, adminUserId } = await createOrganization(auth);
  const admin: Actor = { organizationId, userId: adminUserId, roles: ["admin"] };

  async function addOffice(name = "Sede Centro", timeZone = "America/Argentina/Buenos_Aires") {
    const result = await asAppRole(db, (tx) =>
      createOffice(admin, { name, address: "Calle 1", timeZone }, tx),
    );
    if (!result.ok) {
      throw new Error(`createOffice failed: ${result.reason}`);
    }
    return result.office;
  }

  async function addRoom(officeId: string, name = "Consultorio 1", capacity = 1) {
    const result = await asAppRole(db, (tx) => createRoom(admin, { officeId, name, capacity }, tx));
    if (!result.ok) {
      throw new Error(`createRoom failed: ${result.reason}`);
    }
    return result.room;
  }

  /** A staff member holding `roles`, and the actor they act as. */
  async function addStaff(name: string, roles: Role[] = ["practitioner"]) {
    const local = name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replaceAll(" ", ".");
    const email = `${local}@example.com`;
    const result = await asAppRole(db, (tx) =>
      createStaffMember(admin, { name, email, password: startingPassword, roles }, tx),
    );
    if (!result.ok) {
      throw new Error(`createStaffMember failed: ${result.reason}`);
    }
    const actor: Actor = { organizationId, userId: result.member.userId, roles };
    return { member: result.member, actor };
  }

  return { auth, organizationId, admin, addOffice, addRoom, addStaff };
}
