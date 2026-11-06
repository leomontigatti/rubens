import { clerkClient } from "@clerk/tanstack-react-start/server";
import { createFileRoute } from "@tanstack/react-router";

import { authMode, env } from "../../../lib/identity";
import { organizationObject } from "../../../lib/organization";
import { devOrganizationId, devPassword, staff, staffEmail } from "../../../lib/staff";
import { addDays, instant } from "../../../lib/week";
import type { SeedData } from "../../../org/organization-data";

const colors = ["#e11d48", "#2563eb", "#16a34a", "#d97706"];
const firstNames = [
  "Lucía",
  "Mateo",
  "Sofía",
  "Benjamín",
  "Valentina",
  "Thiago",
  "Emma",
  "Joaquín",
  "Martina",
  "Santiago",
];
const lastNames = ["Fernández", "López"];
const organizationName = "Consultorios Belgrano";

type SeededUser = { id: string; email: string; name: string; role: string };

/**
 * With Clerk: the five staff users (email and password), one organization, and each
 * membership's rubens roles in its public metadata, all through Clerk's Backend API.
 * Idempotent: finds what exists by email and organization name.
 */
async function ensureClerkStaff(): Promise<{ organizationId: string; users: SeededUser[] }> {
  const clerk = clerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
  });
  const users: SeededUser[] = [];
  for (const person of staff) {
    const email = staffEmail(person.email);
    const [firstName, ...rest] = person.name.split(" ");
    let user = (await clerk.users.getUserList({ emailAddress: [email] })).data[0];
    user ??= await clerk.users.createUser({
      emailAddress: [email],
      // This instance's sign-in options require a username.
      username: `rubens_${person.email}`,
      password: devPassword,
      skipPasswordChecks: true,
      firstName,
      lastName: rest.join(" "),
    });
    users.push({ id: user.id, email, name: person.name, role: person.roles.join(",") });
  }
  const admin = users[0]!;
  const memberships = await clerk.users.getOrganizationMembershipList({ userId: admin.id });
  let organizationId = memberships.data.find((m) => m.organization.name === organizationName)
    ?.organization.id;
  organizationId ??= (await clerk.organizations.createOrganization({
    name: organizationName,
    createdBy: admin.id,
  })).id;
  const existing = await clerk.organizations.getOrganizationMembershipList({ organizationId });
  for (const [i, user] of users.entries()) {
    if (!existing.data.some((m) => m.publicUserData?.userId === user.id)) {
      await clerk.organizations.createOrganizationMembership({
        organizationId,
        userId: user.id,
        role: i === 0 ? "org:admin" : "org:member",
      });
    }
    await clerk.organizations.updateOrganizationMembershipMetadata({
      organizationId,
      userId: user.id,
      publicMetadata: { roles: staff[i]!.roles },
    });
  }
  return { organizationId, users };
}

function devStaff(): { organizationId: string; users: SeededUser[] } {
  return {
    organizationId: devOrganizationId,
    users: staff.map((p) => ({ id: p.devId, email: p.devId, name: p.name, role: p.roles.join(",") })),
  };
}

/** One office, two rooms, four practitioners in two shifts per room, 20 patients, Oct–Dec 2026. */
function clinicData(users: { id: string; name: string; role: string }[]): SeedData {
  const office = {
    id: "office-belgrano",
    name: "Sede Belgrano",
    timeZone: "America/Argentina/Buenos_Aires",
  };
  const rooms = [
    { id: "room-1", officeId: office.id, name: "Consultorio 1", capacity: 1 },
    { id: "room-2", officeId: office.id, name: "Consultorio 2", capacity: 2 },
  ];
  const practitioners = users
    .filter((u) => u.role.split(",").includes("practitioner"))
    .map((u, i) => ({
      id: `practitioner-${i + 1}`,
      userId: u.id,
      name: u.name,
      color: colors[i]!,
    }));
  const patients = Array.from({ length: 20 }, (_, i) => ({
    id: `patient-${String(i + 1).padStart(2, "0")}`,
    name: `${firstNames[i % 10]} ${lastNames[Math.floor(i / 10)]}`,
  }));
  const appointments: SeedData["appointments"] = [];
  const now = Date.now();
  let n = 0;
  for (let day = "2026-10-01"; day <= "2026-12-31"; day = addDays(day, 1)) {
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    practitioners.forEach((p, i) => {
      // Practitioners 1 and 2 share room 1, 3 and 4 room 2: mornings and afternoons.
      const roomId = rooms[i < 2 ? 0 : 1]!.id;
      const shiftStart = i % 2 === 0 ? 8 * 60 : 13 * 60;
      for (let slot = 0; slot < 6; slot++) {
        const minutes = shiftStart + slot * 40;
        const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
        const startsAt = instant(day, time);
        n++;
        const status =
          n % 31 === 0
            ? "cancelled"
            : startsAt < now
              ? n % 19 === 0
                ? "noShow"
                : "attended"
              : "booked";
        appointments.push({
          id: `seed-${n}`,
          patientId: patients[n % 20]!.id,
          practitionerId: p.id,
          roomId,
          startsAt,
          endsAt: startsAt + 40 * 60_000,
          status,
          overbooking: false,
          createdBy: users[0]!.id,
        });
      }
    });
    // A weekly overbooking over practitioner 1's 9:20 appointment, as staff book one in rubens.
    if (weekday === 3) {
      const startsAt = instant(day, "09:30");
      appointments.push({
        id: `seed-over-${day}`,
        patientId: patients[(n + 7) % 20]!.id,
        practitionerId: practitioners[0]!.id,
        roomId: rooms[0]!.id,
        startsAt,
        endsAt: startsAt + 20 * 60_000,
        status: startsAt < now ? "attended" : "booked",
        overbooking: true,
        createdBy: users[0]!.id,
      });
    }
  }
  return { office, rooms, practitioners, patients, appointments };
}

export const Route = createFileRoute("/api/dev/seed")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Deployed, the seed answers only a request carrying the SEED_KEY secret (the CPU test).
        const seedKey = env.SEED_KEY;
        const allowed =
          import.meta.env.DEV || (!!seedKey && request.headers.get("x-seed-key") === seedKey);
        if (!allowed) return new Response(null, { status: 404 });
        const { organizationId, users } =
          authMode() === "clerk" ? await ensureClerkStaff() : devStaff();
        const data = clinicData(users);
        const result = await organizationObject(organizationId).seed(data);
        return Response.json({
          organizationId,
          mode: authMode(),
          users: users.map(({ email, role }) => ({ email, role })),
          rooms: data.rooms.length,
          practitioners: data.practitioners.length,
          patients: data.patients.length,
          appointments: data.appointments.length,
          overbookings: data.appointments.filter((a) => a.overbooking).length,
          stats: result.stats,
        });
      },
    },
  },
});
