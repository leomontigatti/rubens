import { defaultTimeZone } from "#/lib/offices.ts";
import { parsePhone } from "#/lib/phones.ts";
import { shiftDate, today, weekdayOf } from "#/lib/schedules.ts";
import { instantOf } from "#/lib/time-ranges.ts";

import type { Caller } from "#/organization/members.ts";
import type { Organization } from "#/organization/organization.ts";

import { accepted } from "#/dev/accepted.ts";
import {
  qaCancellationReasons,
  qaDayStarts,
  qaIncomingMessages,
  qaInsurers,
  qaMedicalServices,
  qaPatients,
  qaPractitioner,
  qaReceptionNotes,
  qaRoom,
  qaWorkingHours,
} from "#/dev/qa-world.ts";
import type { QaPractitioner, QaMedicalService } from "#/dev/qa-world.ts";

/** What the dev seed already made, which the QA data builds on. */
export interface DevBase {
  admin: Caller;
  officeId: string;
  juanId: string;
  devConsultId: string;
  devPatientIds: readonly string[];
}

/** How many days of appointments, today included. */
const days = 8;

/** Bookings start no sooner than this after the seed runs, so they are free starts. */
const leadMs = 10 * 60_000;

/**
 * Adds `src/dev/qa-world.ts` to a dev organization `seedDevOrganization` just
 * set up, through the object's own methods. Only appointments from now on:
 * a past time is bookable only as an overplanned.
 */
export async function seedQaData(
  organization: DurableObjectStub<Organization>,
  base: DevBase,
): Promise<void> {
  const { admin } = base;
  accepted(
    "addMember Laura",
    await organization.addMember(admin, { ...qaPractitioner, roles: ["practitioner"] }),
  );
  const laura = accepted(
    "listSchedulePractitioners",
    await organization.listSchedulePractitioners(admin),
  ).practitioners.find((one) => one.displayName === qaPractitioner.name);
  if (!laura) {
    throw new Error("dev QA seed: Laura has no practitioner");
  }
  const practitionerIds: Record<QaPractitioner, string> = { juan: base.juanId, laura: laura.id };

  const { room } = accepted(
    "createRoom",
    await organization.createRoom(admin, { ...qaRoom, officeId: base.officeId }),
  );
  accepted(
    "createSchedule Laura",
    await organization.createSchedule(admin, {
      ...qaWorkingHours,
      practitionerId: laura.id,
      roomId: room.id,
      weekdays: [1, 2, 3, 4, 5],
      firstDate: today(defaultTimeZone),
      lastDate: null,
    }),
  );

  const medicalServices: Record<QaMedicalService, { id: string; durationMinutes: number }> = {
    devConsult: { id: base.devConsultId, durationMinutes: 30 },
    ...(await createMedicalServices(organization, admin, practitionerIds)),
  };

  const insurerIds: string[] = [];
  for (const insurer of qaInsurers) {
    const created = accepted(
      `createInsurer ${insurer.name}`,
      await organization.createInsurer(admin, insurer),
    );
    insurerIds.push(created.insurer.id);
  }

  const patientIds = [...base.devPatientIds];
  for (const patient of qaPatients) {
    const patientId = await registerQaPatient(organization, admin, patient, insurerIds);
    if (!patient.inactive) {
      patientIds.push(patientId);
    }
  }

  await bookWeek(organization, admin, { practitionerIds, medicalServices, patientIds });
  await addTimeOffAndClosure(organization, admin, laura.id);

  accepted(
    "storeWhatsappEvents QA",
    await organization.storeWhatsappEvents({
      messages: qaIncomingMessages.map((message, index) => ({
        whatsappId: `wamid.qa-${index}`,
        from: accepted("parsePhone", parsePhone(message.from)).phone,
        sentAt: Date.now() - message.minutesAgo * 60_000,
        type: "text",
        text: message.text,
        payload: "{}",
      })),
      statuses: [],
      templateStatuses: [],
    }),
  );
}

async function createMedicalServices(
  organization: DurableObjectStub<Organization>,
  admin: Caller,
  practitionerIds: Record<QaPractitioner, string>,
) {
  const created = {} as Record<
    keyof typeof qaMedicalServices,
    { id: string; durationMinutes: number }
  >;
  for (const [key, fields] of Object.entries(qaMedicalServices)) {
    const { medicalService } = accepted(
      `createMedicalService ${fields.name}`,
      await organization.createMedicalService(admin, {
        name: fields.name,
        durationMinutes: fields.durationMinutes,
        practitionerId: practitionerIds[fields.practitioner],
      }),
    );
    created[key as keyof typeof qaMedicalServices] = {
      id: medicalService.id,
      durationMinutes: fields.durationMinutes,
    };
  }
  return created;
}

async function registerQaPatient(
  organization: DurableObjectStub<Organization>,
  admin: Caller,
  patient: (typeof qaPatients)[number],
  insurerIds: readonly string[],
): Promise<string> {
  const { coverage, guardian, dni, inactive, whatsappConsent, ...fields } = patient;
  const registered = accepted(
    `registerPatient ${patient.lastName}`,
    await organization.registerPatient(admin, {
      ...fields,
      ...(dni ? { documentType: "dni", documentNumber: dni } : {}),
    }),
  );
  const patientId = registered.patient.id;
  if (coverage) {
    accepted(
      `addCoverage ${patient.lastName}`,
      await organization.addCoverage(admin, {
        patientId,
        insurerId: insurerIds[coverage.insurer]!,
        plan: coverage.plan,
        memberNumber: coverage.memberNumber,
      }),
    );
  }
  if (guardian) {
    accepted(
      `addGuardian ${patient.lastName}`,
      await organization.addGuardian(admin, { patientId, ...guardian }),
    );
  }
  if (whatsappConsent === false) {
    accepted(
      `setWhatsappConsent ${patient.lastName}`,
      await organization.setWhatsappConsent(admin, { patientId, whatsappConsent }),
    );
  }
  if (inactive) {
    accepted(
      `setPatientActive ${patient.lastName}`,
      await organization.setPatientActive(admin, { id: patientId, active: false }),
    );
  }
  return patientId;
}

/** The medical service a practitioner's `index`th start of the day takes. */
function medicalServiceAt(practitioner: QaPractitioner, index: number): QaMedicalService {
  if (practitioner === "juan") {
    return index % 2 === 0 ? "devConsult" : "control";
  }
  // Laura's hour-long first visits sit at the starts the next one leaves free.
  return index % 2 === 0 ? "firstVisit" : "followUp";
}

/** The status a booked appointment is left in. */
type QaOutcome =
  | { kind: "booked" }
  | { kind: "status"; status: "confirmed" | "checkedIn" }
  | { kind: "cancelled"; byPatient: boolean };

interface QaAppointment {
  date: string;
  time: string;
  practitioner: QaPractitioner;
  medicalService: QaMedicalService;
  patientIndex: number;
  receptionNote: string | null;
  outcome: QaOutcome;
}

/** The free starts the seed books: each practitioner's working days, unevenly, from `earliest` on. */
function qaStarts(firstDate: string, earliest: number) {
  const starts: {
    day: number;
    date: string;
    time: string;
    practitioner: QaPractitioner;
    index: number;
  }[] = [];
  for (let day = 0; day < days; day++) {
    const date = shiftDate(firstDate, day);
    for (const practitioner of ["juan", "laura"] as const) {
      const works = practitioner === "juan" || weekdayOf(date) <= 5;
      for (const [index, time] of qaDayStarts[practitioner].entries()) {
        const skipped = (index * 2 + day) % 5 === 0;
        if (works && !skipped && +instantOf(date, time, defaultTimeZone) >= earliest) {
          starts.push({ day, date, time, practitioner, index });
        }
      }
    }
  }
  return starts;
}

/**
 * The coming week's bookings: today's next one is checked in, today's and
 * tomorrow's are confirmed, half the next day's too, and every ninth is
 * cancelled, by the business and the patient in turn.
 */
function planQaWeek(firstDate: string, earliest: number): QaAppointment[] {
  let checkedIn = false;
  return qaStarts(firstDate, earliest).map(({ day, index, ...where }, count) => {
    const ordinal = count + 1;
    let outcome: QaOutcome = { kind: "booked" };
    if (ordinal % 9 === 0) {
      outcome = { kind: "cancelled", byPatient: ordinal % 18 === 0 };
    } else if (day === 0 && !checkedIn) {
      checkedIn = true;
      outcome = { kind: "status", status: "checkedIn" };
    } else if (day <= 1 || (day === 2 && ordinal % 2 === 0)) {
      outcome = { kind: "status", status: "confirmed" };
    }
    return {
      ...where,
      medicalService: medicalServiceAt(where.practitioner, index),
      patientIndex: count,
      receptionNote: count % 5 === 2 ? qaReceptionNotes[count % qaReceptionNotes.length]! : null,
      outcome,
    };
  });
}

/** Books the week `planQaWeek` plans from now on, and moves each appointment to its outcome. */
async function bookWeek(
  organization: DurableObjectStub<Organization>,
  admin: Caller,
  plan: {
    practitionerIds: Record<QaPractitioner, string>;
    medicalServices: Record<QaMedicalService, { id: string; durationMinutes: number }>;
    patientIds: readonly string[];
  },
) {
  for (const planned of planQaWeek(today(defaultTimeZone), Date.now() + leadMs)) {
    const medicalService = plan.medicalServices[planned.medicalService];
    const { appointment } = accepted(
      `bookAppointment ${planned.date} ${planned.time} ${planned.practitioner}`,
      await organization.bookAppointment(admin, {
        patientId: plan.patientIds[planned.patientIndex % plan.patientIds.length]!,
        practitionerId: plan.practitionerIds[planned.practitioner],
        medicalServiceId: medicalService.id,
        start: instantOf(planned.date, planned.time, defaultTimeZone),
        durationMinutes: medicalService.durationMinutes,
        receptionNote: planned.receptionNote,
        confirmWarnings: true,
      }),
    );
    await applyOutcome(organization, admin, appointment.id, planned.outcome);
  }
}

async function applyOutcome(
  organization: DurableObjectStub<Organization>,
  admin: Caller,
  appointmentId: string,
  outcome: QaOutcome,
) {
  if (outcome.kind === "cancelled") {
    accepted(
      "cancelAppointment",
      await organization.cancelAppointment(admin, {
        appointmentId,
        cancelledBy: outcome.byPatient ? "patient" : "business",
        reason: qaCancellationReasons[outcome.byPatient ? 0 : 1],
      }),
    );
  } else if (outcome.kind === "status") {
    accepted(
      `changeAppointmentStatus ${outcome.status}`,
      await organization.changeAppointmentStatus(admin, { appointmentId, status: outcome.status }),
    );
  }
}

/**
 * Laura's first weekday from four days out is time off, which sends that
 * day's appointments to the list to reschedule, untold; and the whole
 * organization closes for a day three weeks out.
 */
async function addTimeOffAndClosure(
  organization: DurableObjectStub<Organization>,
  admin: Caller,
  lauraId: string,
) {
  let date = shiftDate(today(defaultTimeZone), 4);
  while (weekdayOf(date) > 5) {
    date = shiftDate(date, 1);
  }
  const timeOff = {
    practitionerId: lauraId,
    entry: { kind: "days" as const, firstDate: date, lastDate: date },
  };
  const first = await organization.createTimeOff(admin, timeOff);
  if (!first.ok && first.reason === "affectsAppointments") {
    accepted(
      "createTimeOff",
      await organization.createTimeOff(admin, {
        ...timeOff,
        tellPatients: false,
        affected: first.affected,
      }),
    );
  } else {
    accepted("createTimeOff", first);
  }
  const closed = shiftDate(today(defaultTimeZone), 21);
  accepted(
    "createClosure",
    await organization.createClosure(admin, {
      officeId: null,
      entry: { kind: "days", firstDate: closed, lastDate: closed },
    }),
  );
}
