import { createFileRoute } from "@tanstack/react-router";
import { env as workerEnv } from "cloudflare:workers";

import type { Env } from "../../../lib/env";

import { getAuth } from "../../../lib/auth";
import { organizationObject } from "../../../lib/organization";
import { addDays, instant } from "../../../lib/week";
import type { SeedData } from "../../../org/organization-data";

export const devPassword = "rubens-dev-password";

const staff = [
  { email: "admin@rubens.example", name: "Ana Admin", role: "admin" },
  { email: "p1@rubens.example", name: "Pablo Pérez", role: "practitioner" },
  { email: "p2@rubens.example", name: "Paula Gómez", role: "practitioner" },
  { email: "p3@rubens.example", name: "Pedro Díaz", role: "practitioner" },
  { email: "p4@rubens.example", name: "Patricia Ruiz", role: "practitioner" },
];
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

async function ensureStaff() {
  const auth = await getAuth();
  const context = await auth.$context;
  const users: { id: string; email: string; name: string; role: string }[] = [];
  for (const person of staff) {
    let user = await context.internalAdapter
      .findUserByEmail(person.email)
      .then((found) => found?.user);
    if (!user) {
      user = await context.internalAdapter.createUser({
        name: person.name,
        email: person.email,
        emailVerified: true,
      });
      await context.internalAdapter.linkAccount({
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: await context.password.hash(devPassword),
      });
    }
    users.push({ ...person, id: user.id });
  }
  const admin = users[0]!;
  let organizationId = (
    await context.adapter.findOne<{ id: string }>({
      model: "organization",
      where: [{ field: "slug", value: "consultorios-belgrano" }],
    })
  )?.id;
  if (!organizationId) {
    const created = await auth.api.createOrganization({
      body: { name: "Consultorios Belgrano", slug: "consultorios-belgrano", userId: admin.id },
    });
    organizationId = created!.id;
  }
  for (const user of users.slice(1)) {
    const existing = await context.adapter.findOne({
      model: "member",
      where: [
        { field: "userId", value: user.id },
        { field: "organizationId", value: organizationId },
      ],
    });
    if (!existing) {
      await auth.api.addMember({ body: { userId: user.id, role: "practitioner", organizationId } });
    }
  }
  return { organizationId, users };
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
    .filter((u) => u.role === "practitioner")
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
        const seedKey = (workerEnv as unknown as Env).SEED_KEY;
        const allowed =
          import.meta.env.DEV || (!!seedKey && request.headers.get("x-seed-key") === seedKey);
        if (!allowed) return new Response(null, { status: 404 });
        const { organizationId, users } = await ensureStaff();
        const data = clinicData(users);
        const result = await organizationObject(organizationId).seed(data);
        return Response.json({
          organizationId,
          users: users.map(({ email, role }) => ({ email, role, password: devPassword })),
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
