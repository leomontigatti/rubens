import { env, runInDurableObject } from "cloudflare:test";
import { eq, sql } from "drizzle-orm";

import type { Role } from "#/lib/access.ts";
import type { BookingInput, OverbookingInput, WarningConfirmation } from "#/lib/appointments.ts";
import type { ScheduleInput } from "#/lib/schedules.ts";
import type { Timing } from "#/lib/template-timing.ts";
import type { AffectsAppointments, Notice } from "#/lib/time-ranges.ts";

import type { AccountMetadata, Accounts, CreateUserResult } from "#/organization/accounts.ts";
import { openDatabase } from "#/organization/database.ts";
import type { Database } from "#/organization/database.ts";
import type { Organization } from "#/organization/organization.ts";
import { auditLog, member } from "#/organization/schema.ts";
import { fakeMeta } from "#/organization/graph-api.test-support.ts";
import type { WorkerEnv } from "#/server/caller.ts";
import { whatsappDirectoryName } from "#/server/whatsapp-directory.ts";

// Fixtures for the organization object's tests (`*.workers.test.ts`): a fresh
// object per call, set up with its first admin, and members by role.

const bindings = env as unknown as WorkerEnv;

export type OrganizationStub = DurableObjectStub<Organization>;

/** A new organization's object, never used by another test. */
export function freshOrganization(): { organizationId: string; organization: OrganizationStub } {
  const organizationId = `test-${crypto.randomUUID()}`;
  return {
    organizationId,
    organization: bindings.ORGANIZATION.get(bindings.ORGANIZATION.idFromName(organizationId)),
  };
}

/** A WhatsApp directory of the test's own, shared with no other test. */
export function freshWhatsappDirectory() {
  return bindings.WHATSAPP_DIRECTORY.get(
    bindings.WHATSAPP_DIRECTORY.idFromName(`directory-${crypto.randomUUID()}`),
  );
}

/** The Worker's one WhatsApp directory, which the organization's object writes. */
export function whatsappDirectory() {
  return bindings.WHATSAPP_DIRECTORY.get(
    bindings.WHATSAPP_DIRECTORY.idFromName(whatsappDirectoryName),
  );
}

export const adminCaller = { userId: "user-admin" };

/**
 * The instant at UTC `time` on `date`, a Monday by default: the booking
 * world's office is in Buenos Aires (UTC-3), so "12:00" is 09:00 there.
 */
export function at(time: string, date = "2099-01-05") {
  return new Date(`${date}T${time}:00Z`);
}

/** The result of a call that must succeed; throws with the refusal otherwise. */
export function expectOk<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) {
    throw new Error(`refused: ${JSON.stringify(result)}`);
  }
  return result as Extract<T, { ok: true }>;
}

/**
 * Saves a time off or a closure the way its form does: as is, then, when the
 * save asks about the appointments it sends to the "to reschedule" list, again
 * with `tellPatients` and the count it asked about.
 */
export async function answeringNotice<
  Save extends (notice: Notice) => PromiseLike<{ ok: boolean }>,
>(tellPatients: boolean, save: Save): Promise<Awaited<ReturnType<Save>>> {
  type T = Awaited<ReturnType<Save>>;
  const first = (await save({})) as T;
  const asked = first as Partial<AffectsAppointments>;
  if (first.ok || asked.reason !== "affectsAppointments") {
    return first;
  }
  return (await save({ tellPatients, affected: asked.affected })) as T;
}

/** A fresh organization, set up with `adminCaller` as its first admin. */
export async function setUpTestOrganization() {
  const fresh = freshOrganization();
  const setUp = await fresh.organization.setUp({
    organizationId: fresh.organizationId,
    name: "Consultorios Prueba",
    admin: { userId: adminCaller.userId, name: "Ana Admin", email: "ana@example.com" },
  });
  if (!setUp.ok) {
    throw new Error(`setUp refused: ${setUp.reason}`);
  }
  return fresh;
}

/** Adds a member with `roles`, as the first admin, and returns them as a caller. */
export async function addMember(organization: OrganizationStub, roles: Role[]) {
  const userId = `user-${crypto.randomUUID()}`;
  const added = await organization.addMember(adminCaller, {
    userId,
    name: `Miembro ${roles.join(" ")}`,
    email: `${userId}@example.com`,
    roles,
  });
  if (!added.ok) {
    throw new Error(`addMember refused: ${added.reason}`);
  }
  return { userId };
}

/**
 * An admin the object refuses for its state: one who must still replace the
 * starting password, or one deactivated.
 */
export async function addRefusedAdmin(
  organization: OrganizationStub,
  state: "mustChangePassword" | "deactivated",
) {
  const admin = await addMember(organization, ["admin"]);
  await inStorage(organization, (database) =>
    database
      .update(member)
      .set(state === "deactivated" ? { active: false } : { mustChangePassword: true })
      .where(eq(member.userId, admin.userId))
      .run(),
  );
  return admin;
}

/**
 * Adds a member named `name` with `roles`, as the first admin, and returns
 * them as a caller, with their practitioner id when they hold the role.
 */
export async function addStaff(
  organization: OrganizationStub,
  name: string,
  roles: Role[] = ["practitioner"],
) {
  const userId = `user-${crypto.randomUUID()}`;
  const added = await organization.addMember(adminCaller, {
    userId,
    name,
    email: `${userId}@example.com`,
    roles,
  });
  if (!added.ok) {
    throw new Error(`addMember refused: ${added.reason}`);
  }
  const listed = await organization.listSchedulePractitioners(adminCaller);
  const practitionerId = listed.ok
    ? listed.practitioners.find((row) => row.displayName === name)?.id
    : undefined;
  return { caller: { userId }, practitionerId: practitionerId ?? "" };
}

/** Adds an office, as the first admin, in `timeZone` or the default one. */
export async function addOffice(organization: OrganizationStub, name: string, timeZone?: string) {
  const created = await organization.createOffice(adminCaller, {
    name,
    address: "Av. Colón 100",
    timeZone,
  });
  if (!created.ok) {
    throw new Error(`createOffice refused: ${created.reason}`);
  }
  return created.office;
}

/** Adds a room to `officeId`, as the first admin. */
export async function addRoom(
  organization: OrganizationStub,
  officeId: string,
  name: string,
  capacity = 1,
) {
  const created = await organization.createRoom(adminCaller, { officeId, name, capacity });
  if (!created.ok) {
    throw new Error(`createRoom refused: ${created.reason}`);
  }
  return created.room;
}

/**
 * An organization ready for booking: "Sede Centro" in Buenos Aires (UTC-3)
 * with "Consultorio 1" and "Consultorio 2", the practitioners "Juan Gómez" and
 * "Lucía Díaz", and "Rita Paz" at reception. Schedules default to Mondays from
 * 09:00 to 11:00 in "Consultorio 1" from 2099-01-05, a Monday.
 */
export async function setUpBookingWorld() {
  const { organization } = await setUpTestOrganization();
  const office = await addOffice(organization, "Sede Centro");
  const room = await addRoom(organization, office.id, "Consultorio 1");
  const otherRoom = await addRoom(organization, office.id, "Consultorio 2");
  const juan = await addStaff(organization, "Juan Gómez");
  const lucia = await addStaff(organization, "Lucía Díaz");
  const receptionist = (await addStaff(organization, "Rita Paz", ["receptionist"])).caller;

  async function addSchedule(input: Partial<ScheduleInput> & { practitionerId: string }) {
    const result = await organization.createSchedule(adminCaller, {
      roomId: room.id,
      weekdays: [1],
      startTime: "09:00",
      endTime: "11:00",
      firstDate: "2099-01-05",
      lastDate: null,
      ...input,
    });
    if (!result.ok) {
      throw new Error(`createSchedule refused: ${result.reason}`);
    }
    return result.schedule;
  }

  async function addMedicalService(practitionerId: string, durationMinutes = 30) {
    const result = await organization.createMedicalService(adminCaller, {
      practitionerId,
      name: "Consulta",
      durationMinutes,
    });
    if (!result.ok) {
      throw new Error(`createMedicalService refused: ${result.reason}`);
    }
    return result.medicalService;
  }

  async function addPatient(firstName: string, phone: string) {
    const result = await organization.registerPatient(adminCaller, {
      firstName,
      lastName: "Paz",
      phone,
    });
    if (!result.ok) {
      throw new Error(`registerPatient refused: ${result.reason}`);
    }
    return result.patient;
  }

  /** Books `input`, as reception unless `caller` is given; throws on a refusal. */
  async function book(input: BookingInput & WarningConfirmation, caller = receptionist) {
    const result = await organization.bookAppointment(caller, input);
    if (!result.ok) {
      throw new Error(`bookAppointment refused: ${result.reason}`);
    }
    return result.appointment;
  }

  /** Books the overbooking `input`, as reception unless `caller` is given; throws on a refusal. */
  async function overbook(input: OverbookingInput & WarningConfirmation, caller = receptionist) {
    const result = await organization.bookOverbooking(caller, input);
    if (!result.ok) {
      throw new Error(`bookOverbooking refused: ${result.reason}`);
    }
    return result.appointment;
  }

  /** Makes `templateIds` the templates the medical service `medicalServiceId` sends. */
  async function pickTemplates(medicalServiceId: string, templateIds: string[]) {
    let service;
    for (const { practitionerId } of [juan, lucia]) {
      const listed = await organization.listMedicalServices(adminCaller, {
        practitionerId,
        includeInactive: true,
      });
      service ??= listed.ok
        ? listed.medicalServices.find((one) => one.id === medicalServiceId)
        : undefined;
    }
    if (!service) {
      throw new Error(`no medical service ${medicalServiceId}`);
    }
    const result = await organization.updateMedicalService(adminCaller, {
      medicalServiceId,
      name: service.name,
      durationMinutes: service.durationMinutes,
      rescheduleCutoffHours: service.rescheduleCutoffHours,
      templateIds,
    });
    if (!result.ok) {
      throw new Error(`updateMedicalService refused: ${result.reason}`);
    }
  }

  /** The appointment as the object shows it to `caller`, the first admin unless given; throws on a refusal. */
  async function appointmentOf(appointmentId: string, caller = adminCaller) {
    const result = await organization.getAppointment(caller, { appointmentId });
    if (!result.ok) {
      throw new Error(`getAppointment refused: ${result.reason}`);
    }
    return result.appointment;
  }

  return {
    organization,
    office,
    room,
    otherRoom,
    juan,
    lucia,
    receptionist,
    addSchedule,
    addMedicalService,
    pickTemplates,
    addPatient,
    book,
    overbook,
    appointmentOf,
  };
}

/**
 * Calls the object's methods on its instance, not through the stub: for a
 * method expected to throw. A throw across RPC is logged inside the object as
 * an uncaught exception, which the Workers test runner fails the run on.
 */
export function inObject<T>(
  organization: OrganizationStub,
  work: (instance: Organization) => Promise<T>,
) {
  // The stub's overload types the instance as RPC's branded type; it is the object itself.
  return runInDurableObject(organization, (instance) => work(instance as unknown as Organization));
}

/** Runs `work` on the object's storage directly: for what no method reads or writes yet. */
export function inStorage<T>(organization: OrganizationStub, work: (database: Database) => T) {
  return runInDurableObject(organization, (_instance, state) => work(openDatabase(state.storage)));
}

/** The template the WhatsApp settings list by `match`, as the admin. */
async function listedTemplate(
  organization: OrganizationStub,
  match: (one: { id: string; name: string }) => boolean,
) {
  const settings = await organization.whatsappSettings(adminCaller);
  const found = settings.ok ? settings.templates.find(match) : undefined;
  if (!found) {
    throw new Error("no such template");
  }
  return found;
}

/** The id of the template named `name`, such as one of the drafts every organization starts with. */
export async function templateNamed(organization: OrganizationStub, name: string) {
  return (await listedTemplate(organization, (one) => one.name === name)).id;
}

/**
 * Submits `body` as the admin, as a new version of template `templateId`
 * (its draft when not given), keeping its name and timing unless
 * `timing` is given, and has Meta answer `status` at once with `metaId`.
 */
export async function submitTemplate(
  organization: OrganizationStub,
  templateId: string,
  options: { status: "APPROVED" | "PENDING"; metaId: string; body?: string; timing?: Timing },
) {
  const listed = await listedTemplate(organization, (one) => one.id === templateId);
  fakeMeta.answerNextWith(200, { id: options.metaId, status: options.status, category: "UTILITY" });
  const result = await organization.editTemplate(adminCaller, {
    templateId,
    body: options.body ?? listed.draft!,
    settings: listed.event ? null : { name: listed.name, timing: options.timing ?? listed.timing! },
  });
  if (!result.ok) {
    throw new Error(`editTemplate refused: ${result.reason}`);
  }
  fakeMeta.requests = [];
}

/** The audit entries about `entityId`, oldest first, as the log keeps them. */
export function auditEntriesFor(organization: OrganizationStub, entityId: string) {
  return inStorage(organization, (database) =>
    database
      .select({
        action: auditLog.action,
        entityType: auditLog.entityType,
        userId: auditLog.userId,
        patientId: auditLog.patientId,
        before: auditLog.before,
        after: auditLog.after,
      })
      .from(auditLog)
      .where(eq(auditLog.entityId, entityId))
      // Insertion order: two entries can share a millisecond.
      .orderBy(sql`rowid`)
      .all(),
  );
}

type Call = { [K in keyof Accounts]: [K, ...Parameters<Accounts[K]>] }[keyof Accounts];

type UserRefusal = Extract<CreateUserResult, { ok: false }>["reason"];

interface FakeUser {
  userId: string;
  email: string;
  metadata: Partial<AccountMetadata>;
}

/**
 * A stand-in for Clerk's accounts. It records every call, keeps one user per
 * email, and accepts a password only when it is the user's current one.
 */
class FakeAccounts implements Accounts {
  calls: Call[] = [];
  lastUserId: string | undefined;
  readonly #passwords = new Map<string, string>();
  readonly #users = new Map<string, FakeUser>();
  readonly #holds = new Map<keyof Accounts, Promise<void>>();
  readonly #failures = new Set<keyof Accounts>();
  #refusal: UserRefusal | undefined;

  /** Forgets the calls and the users: what each test starts from. */
  reset() {
    this.calls = [];
    this.#users.clear();
    this.#holds.clear();
    this.#failures.clear();
    this.#refusal = undefined;
  }

  /** Makes the next `method` call throw, after it is recorded: Clerk unreachable. */
  failNext(method: keyof Accounts) {
    this.#failures.add(method);
  }

  /** Refuses the next user created, as Clerk would. */
  refuseNext(reason: UserRefusal) {
    this.#refusal = reason;
  }

  /** Forgets every password, so any current password is wrong. */
  rejectPasswords() {
    this.#passwords.clear();
  }

  /** A user Clerk already holds, as an earlier create that never became a member leaves it. */
  addUser(email: string, metadata: Partial<AccountMetadata>) {
    const userId = `user-${crypto.randomUUID()}`;
    this.#users.set(userId, { userId, email, metadata });
    return userId;
  }

  /** Whether Clerk still holds `userId`. */
  hasUser(userId: string) {
    return this.#users.has(userId);
  }

  /**
   * Makes the next `method` call wait, after it is recorded and has taken
   * effect, until the returned function is called: Clerk answering slowly.
   */
  hold(method: keyof Accounts) {
    let release = () => {};
    this.#holds.set(
      method,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return () => release();
  }

  async #answer<T>(method: keyof Accounts, value: T): Promise<T> {
    const held = this.#holds.get(method);
    this.#holds.delete(method);
    await held;
    if (this.#failures.delete(method)) {
      throw new Error(`Clerk is unreachable (${method})`);
    }
    return value;
  }

  createUser(user: Parameters<Accounts["createUser"]>[0]): Promise<CreateUserResult> {
    this.calls.push(["createUser", user]);
    const refusal = this.#refusal;
    this.#refusal = undefined;
    if (refusal) {
      return this.#answer("createUser", { ok: false, reason: refusal });
    }
    if ([...this.#users.values()].some((existing) => existing.email === user.email)) {
      return this.#answer("createUser", { ok: false, reason: "emailTaken" });
    }
    const userId = `user-${crypto.randomUUID()}`;
    this.lastUserId = userId;
    this.#users.set(userId, { userId, email: user.email, metadata: user.metadata });
    this.#passwords.set(userId, user.password);
    return this.#answer("createUser", { ok: true, userId });
  }

  updateMetadata(...call: Parameters<Accounts["updateMetadata"]>) {
    this.calls.push(["updateMetadata", ...call]);
    const [userId, metadata] = call;
    const user = this.#users.get(userId);
    if (user) {
      user.metadata = { ...user.metadata, ...metadata };
    }
    return this.#answer("updateMetadata", undefined);
  }

  setPassword(userId: string, password: string) {
    this.calls.push(["setPassword", userId, password]);
    this.#passwords.set(userId, password);
    return this.#answer("setPassword", { ok: true as const });
  }

  verifyPassword(userId: string, password: string) {
    this.calls.push(["verifyPassword", userId, password]);
    return this.#answer("verifyPassword", this.#passwords.get(userId) === password);
  }

  findUserByEmail(email: string) {
    this.calls.push(["findUserByEmail", email]);
    const user = [...this.#users.values()].find((existing) => existing.email === email);
    return this.#answer(
      "findUserByEmail",
      user && { userId: user.userId, metadata: { ...user.metadata } },
    );
  }

  deleteUser(userId: string) {
    this.calls.push(["deleteUser", userId]);
    this.#users.delete(userId);
    return this.#answer("deleteUser", undefined);
  }

  ban(userId: string) {
    this.calls.push(["ban", userId]);
    return this.#answer("ban", undefined);
  }

  unban(userId: string) {
    this.calls.push(["unban", userId]);
    return this.#answer("unban", undefined);
  }
}

/**
 * The accounts a test installs in place of Clerk's, with
 * `vi.mock(import("#/organization/accounts.ts"), …)` returning it from
 * `accountsFor`. The object and the test share one isolate, so the test reads
 * the calls the object made.
 */
export const fakeAccounts = new FakeAccounts();

export {
  fakeMeta,
  metaAccessToken,
  metaBusinessAccountId,
  metaBusinessToken,
  metaPhoneNumberId,
} from "#/organization/graph-api.test-support.ts";

export {
  afterTheWait,
  patientSends,
  patientSpeaks,
  patientWrites,
  scriptedModel,
  scriptedTranscriber,
} from "#/organization/assistant-model.test-support.ts";
