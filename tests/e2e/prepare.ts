import { spawnSync } from "node:child_process";
import process from "node:process";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema/index.ts";
import type { Actor } from "#/lib/access.ts";
import { createAuth } from "#/lib/auth.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { today } from "#/lib/schedules.ts";
import { changeOwnPassword } from "#/server/accounts.ts";
import { createMedicalService } from "#/server/medical-services.ts";
import { createOffice, createRoom } from "#/server/offices.ts";
import { registerPatient } from "#/server/patients.ts";
import { createSchedule, listSchedulePractitioners } from "#/server/schedules.ts";
import { setupOrganization } from "#/server/setup.ts";
import { createStaffMember } from "#/server/staff.ts";

import { databaseUrlFor } from "../../scripts/worktree-db.ts";
import { e2e } from "./environment.ts";
import {
  medicalServiceName,
  officeName,
  organizationName,
  people,
  roomName,
  seededPatients,
  workingHours,
} from "./world.test-support.ts";

// The browser suite's database, rebuilt on every `pnpm test:e2e`: dropped,
// migrated as the app ships, and seeded with `world.test-support.ts`. The only file of the
// suite that knows the backend: a port to another one swaps this file and the
// sign-in in `auth.setup.ts`, and no spec.
//
// Rows go in through the services the app itself calls, as the app role, so
// the seed obeys the same rules and row-level security as a screen would.

const startingPassword = (password: string) => `${password}-starting`;

function ok<T extends { ok: boolean }>(what: string, result: T): Extract<T, { ok: true }> {
  if (!result.ok) {
    throw new Error(`${what} refused: ${JSON.stringify(result)}`);
  }
  return result as Extract<T, { ok: true }>;
}

async function recreateDatabase() {
  const owner = new URL(e2e.directDatabaseUrl);
  const name = owner.pathname.slice(1);
  const maintenance = new Pool({
    connectionString: databaseUrlFor(e2e.directDatabaseUrl, "postgres"),
    max: 1,
  });
  try {
    // `with (force)` ends a session a killed run left open on it.
    await maintenance.query(`drop database if exists "${name}" with (force)`);
    await maintenance.query(`create database "${name}"`);
  } finally {
    await maintenance.end();
  }
}

function migrate() {
  const result = spawnSync("node", ["scripts/migrate.mjs"], {
    env: { ...process.env, DATABASE_DIRECT_URL: e2e.directDatabaseUrl },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`migrate exited with ${result.status}`);
  }
}

async function seed() {
  const ownerPool = new Pool({ connectionString: e2e.directDatabaseUrl, max: 1 });
  const appPool = new Pool({ connectionString: e2e.databaseUrl, max: 1 });
  try {
    const ownerAuth = createAuth(drizzle(ownerPool, { schema }));
    const app = drizzle(appPool, { schema });

    const setup = ok(
      "setupOrganization",
      await setupOrganization(ownerAuth, {
        organizationName,
        adminName: people.admin.name,
        adminEmail: people.admin.email,
        password: startingPassword(people.admin.password),
      }),
    );
    const admin: Actor = {
      organizationId: setup.organizationId,
      userId: setup.userId,
      roles: ["admin"],
    };

    const userIds = { admin: setup.userId } as Record<keyof typeof people, string>;
    for (const role of ["receptionist", "practitioner"] as const) {
      const created = ok(
        `createStaffMember ${role}`,
        await createStaffMember(
          admin,
          {
            name: people[role].name,
            email: people[role].email,
            password: startingPassword(people[role].password),
            roles: [role],
          },
          app,
        ),
      );
      userIds[role] = created.member.userId;
    }
    // Each person has replaced the starting password, as at a first sign-in.
    for (const [role, person] of Object.entries(people) as [
      keyof typeof people,
      typeof people.admin,
    ][]) {
      ok(
        `changeOwnPassword ${role}`,
        await changeOwnPassword(ownerAuth, userIds[role], {
          currentPassword: startingPassword(person.password),
          newPassword: person.password,
        }),
      );
    }

    const { office } = ok(
      "createOffice",
      await createOffice(
        admin,
        { name: officeName, address: "Calle Falsa 123", timeZone: defaultTimeZone },
        app,
      ),
    );
    const { room } = ok(
      "createRoom",
      await createRoom(admin, { officeId: office.id, name: roomName }, app),
    );

    const practitionerId = await practitionerIdOf(app, admin, userIds.practitioner);
    ok(
      "createSchedule",
      await createSchedule(
        admin,
        {
          practitionerId,
          roomId: room.id,
          weekdays: [1, 2, 3, 4, 5, 6, 7],
          ...workingHours,
          firstDate: today(defaultTimeZone),
          lastDate: null,
        },
        app,
      ),
    );
    ok(
      "createMedicalService",
      await createMedicalService(
        admin,
        { practitionerId, name: medicalServiceName, durationMinutes: 30 },
        app,
      ),
    );

    for (const patient of seededPatients) {
      ok(`registerPatient ${patient.firstName}`, await registerPatient(admin, patient, app));
    }
  } finally {
    await Promise.all([ownerPool.end(), appPool.end()]);
  }
}

async function practitionerIdOf(
  app: Parameters<typeof createSchedule>[2],
  admin: Actor,
  userId: string,
) {
  const listed = await listSchedulePractitioners(admin, app);
  const found = listed.find((row) => row.displayName === people.practitioner.name);
  if (!found) {
    throw new Error(`no practitioner row for user ${userId}`);
  }
  return found.id;
}

await recreateDatabase();
migrate();
await seed();
console.log(`e2e database ready: ${new URL(e2e.directDatabaseUrl).pathname.slice(1)}`);
