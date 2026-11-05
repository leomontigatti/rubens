import { DurableObject } from "cloudflare:workers";
import { and, asc, eq, gt, gte, inArray, lt, lte, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";

import { type Caller, type Role, parseRoles } from "../lib/access";
import type { Env } from "../lib/env";
import * as schema from "./schema";

const { appointment, office, patient, practitioner, reminder, room } = schema;

/** The statuses migration 0013's exclusion constraints cover. */
const activeStatuses = ["booked", "confirmed", "checkedIn", "attended"];
const maxDurationMs = 720 * 60_000;

export type Refusal = { ok: false; reason: "notMember" | "forbidden" | "timeTaken" | "invalid" };

export interface Stats {
  /** SQLite rows read and written by this call, from the cursors Drizzle ran. */
  rowsRead: number;
  rowsWritten: number;
  /** Wall time spent inside the object, ms (locally ≈ CPU, the object does no I/O but D1). */
  objectMs: number;
  /** D1 queries the membership check ran (0 when cached). */
  d1Queries: number;
}

export interface BookingInput {
  patientId: string;
  practitionerId: string;
  roomId: string;
  startsAt: number;
  endsAt: number;
  overbooking?: boolean;
  /** Seconds until the reminder fires; rubens sends it a day ahead, the checks a few seconds ahead. */
  remindInSeconds?: number;
}

export interface SeedData {
  office: typeof office.$inferInsert;
  rooms: (typeof room.$inferInsert)[];
  practitioners: (typeof practitioner.$inferInsert)[];
  patients: (typeof patient.$inferInsert)[];
  appointments: (typeof appointment.$inferInsert)[];
}

const membershipTtlMs = 30_000;

/**
 * One organization's clinic data (ui: offices, rooms, practitioners, patients,
 * appointments), in the object's own SQLite. Every method takes the caller the
 * Worker resolved from the session and checks it against Better Auth's `member`
 * table in D1 before touching data.
 */
export class OrganizationData extends DurableObject<Env> {
  private cursors: SqlStorageCursor<Record<string, SqlStorageValue>>[] = [];
  private d1Queries = 0;
  private memberships = new Map<string, { roles: Role[]; until: number }>();
  private db;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    // Drizzle reads `sql.exec` and `transactionSync`; the wrapper keeps each cursor
    // so a call can report the rows it read.
    const counted = {
      sql: {
        exec: (query: string, ...bindings: unknown[]) => {
          const cursor = sql.exec(query, ...bindings);
          this.cursors.push(cursor);
          return cursor;
        },
      },
      transactionSync: <T>(fn: () => T) => ctx.storage.transactionSync(fn),
    } as unknown as DurableObjectStorage;
    this.db = drizzle(counted, { schema });
    ctx.blockConcurrencyWhile(async () => {
      sql.exec(schema.schemaSql);
    });
  }

  // ---------------------------------------------------------------- access

  private async authorize(caller: Caller, allowed: readonly Role[]): Promise<Refusal | Role[]> {
    if (this.ctx.id.name !== undefined && caller.organizationId !== this.ctx.id.name) {
      return { ok: false, reason: "notMember" };
    }
    const cached = this.memberships.get(caller.userId);
    let roles: Role[] | undefined;
    if (cached && cached.until > Date.now()) {
      roles = cached.roles;
    } else {
      this.d1Queries++;
      const row = await this.env.DB.prepare(
        'select role from member where "userId" = ? and "organizationId" = ?',
      )
        .bind(caller.userId, caller.organizationId)
        .first<{ role: string }>();
      if (!row) {
        this.memberships.delete(caller.userId);
        return { ok: false, reason: "notMember" };
      }
      roles = parseRoles(row.role);
      this.memberships.set(caller.userId, { roles, until: Date.now() + membershipTtlMs });
    }
    if (!roles.some((role) => allowed.includes(role))) {
      return { ok: false, reason: "forbidden" };
    }
    return roles;
  }

  private begin() {
    this.cursors = [];
    this.d1Queries = 0;
    return performance.now();
  }

  private stats(startedAt: number): Stats {
    let rowsRead = 0;
    let rowsWritten = 0;
    for (const cursor of this.cursors) {
      rowsRead += cursor.rowsRead;
      rowsWritten += cursor.rowsWritten;
    }
    this.cursors = [];
    return {
      rowsRead,
      rowsWritten,
      objectMs: performance.now() - startedAt,
      d1Queries: this.d1Queries,
    };
  }

  // ---------------------------------------------------------------- reads

  async agenda(caller: Caller, input: { officeId?: string; from: number; to: number }) {
    const startedAt = this.begin();
    const access = await this.authorize(caller, ["admin", "receptionist", "practitioner"]);
    if (!Array.isArray(access)) return { ...access, stats: this.stats(startedAt) };
    const offices = this.db.select().from(office).all();
    const current = offices.find((o) => o.id === input.officeId) ?? offices[0];
    if (!current)
      return { ok: true as const, offices, office: undefined, stats: this.stats(startedAt) };
    const rooms = this.db.select().from(room).where(eq(room.officeId, current.id)).all();
    const practitioners = this.db.select().from(practitioner).orderBy(asc(practitioner.name)).all();
    const patients = this.db.select().from(patient).orderBy(asc(patient.name)).all();
    const roomIds = rooms.map((r) => r.id);
    const appointments = roomIds.length
      ? this.db
          .select({
            id: appointment.id,
            practitionerId: appointment.practitionerId,
            roomId: appointment.roomId,
            startsAt: appointment.startsAt,
            endsAt: appointment.endsAt,
            status: appointment.status,
            overbooking: appointment.overbooking,
            remindedAt: appointment.remindedAt,
            patientName: patient.name,
          })
          .from(appointment)
          .innerJoin(patient, eq(patient.id, appointment.patientId))
          .where(
            and(
              inArray(appointment.roomId, roomIds),
              gte(appointment.startsAt, input.from),
              lt(appointment.startsAt, input.to),
            ),
          )
          .orderBy(asc(appointment.startsAt))
          .all()
      : [];
    return {
      ok: true as const,
      offices,
      office: current,
      rooms,
      practitioners,
      patients,
      appointments,
      stats: this.stats(startedAt),
    };
  }

  async getAppointment(caller: Caller, id: string) {
    const startedAt = this.begin();
    const access = await this.authorize(caller, ["admin", "receptionist", "practitioner"]);
    if (!Array.isArray(access)) return { ...access, stats: this.stats(startedAt) };
    const row = this.db.select().from(appointment).where(eq(appointment.id, id)).get();
    return { ok: true as const, appointment: row, stats: this.stats(startedAt) };
  }

  async countAppointments(caller: Caller) {
    const access = await this.authorize(caller, ["admin", "receptionist", "practitioner"]);
    if (!Array.isArray(access)) return access;
    const rows = this.ctx.storage.sql
      .exec<{ status: string; n: number }>(
        "select status, count(*) as n from appointment group by status",
      )
      .toArray();
    return { ok: true as const, byStatus: Object.fromEntries(rows.map((r) => [r.status, r.n])) };
  }

  // ---------------------------------------------------------------- writes

  /**
   * Books an appointment, checking migration 0013's two exclusion constraints in
   * one synchronous transaction: nothing awaits between the checks and the insert,
   * so no other request runs in between (the object is single-threaded, and the
   * output gate holds the reply until the write is durable).
   */
  async book(caller: Caller, input: BookingInput) {
    const startedAt = this.begin();
    const access = await this.authorize(caller, ["admin", "receptionist", "practitioner"]);
    if (!Array.isArray(access)) return { ...access, stats: this.stats(startedAt) };
    const { startsAt, endsAt } = input;
    if (!(startsAt < endsAt) || endsAt - startsAt > maxDurationMs) {
      return { ok: false as const, reason: "invalid" as const, stats: this.stats(startedAt) };
    }
    const overbooking = input.overbooking === true;
    const id = crypto.randomUUID();

    const result = this.db.transaction((tx) => {
      // Rows that can overlap [startsAt, endsAt): bounded by the longest duration,
      // so the lookup stays on the (…, starts_at) index.
      const overlapping = and(
        gt(appointment.startsAt, startsAt - maxDurationMs),
        lt(appointment.startsAt, endsAt),
        gt(appointment.endsAt, startsAt),
        inArray(appointment.status, activeStatuses),
      );
      // appointment_practitioner_overlap: partial, overbookings outside it on both sides.
      if (!overbooking) {
        const clash = tx
          .select({ id: appointment.id })
          .from(appointment)
          .where(
            and(
              eq(appointment.practitionerId, input.practitionerId),
              eq(appointment.overbooking, false),
              overlapping,
            ),
          )
          .limit(1)
          .get();
        if (clash) return "practitioner" as const;
      }
      // appointment_room_overlap: another practitioner's active appointment in the
      // room, overbookings included.
      const roomClash = tx
        .select({ id: appointment.id })
        .from(appointment)
        .where(
          and(
            eq(appointment.roomId, input.roomId),
            ne(appointment.practitionerId, input.practitionerId),
            overlapping,
          ),
        )
        .limit(1)
        .get();
      if (roomClash) return "room" as const;

      tx.insert(appointment)
        .values({
          id,
          patientId: input.patientId,
          practitionerId: input.practitionerId,
          roomId: input.roomId,
          startsAt,
          endsAt,
          status: "booked",
          overbooking,
          createdBy: caller.userId,
        })
        .run();
      // The reminder is enqueued in the same transaction as the booking, as pg-boss allows in rubens.
      const dueAt =
        input.remindInSeconds !== undefined
          ? Date.now() + input.remindInSeconds * 1000
          : startsAt - 86_400_000;
      tx.insert(reminder).values({ appointmentId: id, dueAt }).run();
      return "booked" as const;
    });

    if (result !== "booked") {
      // Which of 0013's constraints refused it: rubens reports both as "time already taken".
      return {
        ok: false as const,
        reason: "timeTaken" as const,
        constraint: result,
        stats: this.stats(startedAt),
      };
    }
    await this.armAlarm();
    return { ok: true as const, id, stats: this.stats(startedAt) };
  }

  /** Admin only: the action the check uses to show a practitioner refused. */
  async createRoom(caller: Caller, input: { officeId: string; name: string; capacity: number }) {
    const startedAt = this.begin();
    const access = await this.authorize(caller, ["admin"]);
    if (!Array.isArray(access)) return { ...access, stats: this.stats(startedAt) };
    const id = crypto.randomUUID();
    this.db
      .insert(room)
      .values({ id, ...input })
      .run();
    return { ok: true as const, id, stats: this.stats(startedAt) };
  }

  // ---------------------------------------------------------------- reminders

  private async armAlarm() {
    const next = this.db
      .select({ dueAt: reminder.dueAt })
      .from(reminder)
      .orderBy(asc(reminder.dueAt))
      .limit(1)
      .get();
    if (!next) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const current = await this.ctx.storage.getAlarm();
    if (current === null || next.dueAt < current) {
      await this.ctx.storage.setAlarm(Math.max(next.dueAt, Date.now()));
    }
  }

  /** Marks every due appointment reminded (sending the message is out of the slice), then re-arms. */
  async alarm() {
    const now = Date.now();
    this.db.transaction((tx) => {
      const due = tx.select().from(reminder).where(lte(reminder.dueAt, now)).all();
      for (const { appointmentId } of due) {
        tx.update(appointment)
          .set({ remindedAt: now })
          .where(eq(appointment.id, appointmentId))
          .run();
        tx.delete(reminder).where(eq(reminder.appointmentId, appointmentId)).run();
      }
      console.log(`[reminders] marked ${due.length} appointment(s) reminded`);
    });
    // setAlarm inside alarm() needs the old one cleared first.
    const next = this.db
      .select({ dueAt: reminder.dueAt })
      .from(reminder)
      .orderBy(asc(reminder.dueAt))
      .limit(1)
      .get();
    if (next) await this.ctx.storage.setAlarm(Math.max(next.dueAt, Date.now()));
  }

  // ---------------------------------------------------------------- dev seed

  async seed(data: SeedData) {
    const startedAt = this.begin();
    this.db.transaction((tx) => {
      for (const table of [reminder, appointment, patient, practitioner, room, office])
        tx.delete(table).run();
      tx.insert(office).values(data.office).run();
      tx.insert(room).values(data.rooms).run();
      tx.insert(practitioner).values(data.practitioners).run();
      tx.insert(patient).values(data.patients).run();
      // Durable Object SQLite allows 100 bound parameters per statement: 9 rows of 10 columns.
      for (let i = 0; i < data.appointments.length; i += 9) {
        tx.insert(appointment)
          .values(data.appointments.slice(i, i + 9))
          .run();
      }
    });
    await this.ctx.storage.deleteAlarm();
    this.memberships.clear();
    return { ok: true as const, stats: this.stats(startedAt) };
  }
}
