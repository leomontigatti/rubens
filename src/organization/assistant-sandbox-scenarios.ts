import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";

import { sandboxStartSchema } from "#/lib/assistant-sandbox.ts";
import type { SandboxStart, SandboxState } from "#/lib/assistant-sandbox.ts";
import { fillTemplate, templateValues } from "#/lib/template-filling.ts";

import type { Database } from "#/organization/database.ts";
import { organizationName } from "#/organization/members.ts";
import { upcomingStatuses } from "#/organization/template-messages.ts";
import {
  appointment,
  guardian,
  medicalService,
  office,
  patient,
  practitioner,
  room,
} from "#/organization/schema.ts";
import { medicalServiceTemplate, template } from "#/organization/whatsapp-schema.ts";
import { approvedVersion } from "#/organization/whatsapp-templates.ts";

// The scenarios the assistant's sandbox starts from (`assistant-sandbox.ts`):
// an upcoming appointment, its patient's number, and the reminder they just
// read.

/** The scenarios to start from: the upcoming appointments, soonest first, this many. */
const scenarioCount = 50;

/** The appointment and the patient a scenario starts from, with the number that reaches them. */
function scenarioRows(database: Database) {
  return database
    .select({
      appointmentId: appointment.id,
      startsAt: appointment.startsAt,
      firstName: patient.firstName,
      lastName: patient.lastName,
      chosenName: patient.chosenName,
      phone: patient.phone,
      guardianPhone: guardian.phone,
      practitionerName: practitioner.displayName,
      officeAddress: office.address,
      medicalServiceName: medicalService.name,
      medicalServiceId: appointment.medicalServiceId,
    })
    .from(appointment)
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
    .innerJoin(room, eq(room.id, appointment.roomId))
    .innerJoin(office, eq(office.id, room.officeId))
    .innerJoin(medicalService, eq(medicalService.id, appointment.medicalServiceId))
    .leftJoin(guardian, and(eq(guardian.patientId, patient.id), eq(guardian.messageContact, true)))
    .$dynamic();
}

/** An appointment a scenario can start from or go on with: booked or confirmed, and not begun. */
function isUpcoming() {
  return and(inArray(appointment.status, upcomingStatuses), gt(appointment.startsAt, Date.now()));
}

/** The upcoming appointment `appointmentId` with the number its patient is reached at, or `null`. */
export function scenarioOf(database: Database, appointmentId: string) {
  const found = scenarioRows(database)
    .where(and(eq(appointment.id, appointmentId), isUpcoming()))
    .get();
  const phone = found && (found.guardianPhone ?? found.phone);
  return found && phone ? { ...found, phone } : null;
}

/** The upcoming appointments a sandbox can start from: those whose patient WhatsApp reaches. */
export function listSandboxScenarios(database: Database) {
  const rows = scenarioRows(database)
    .where(and(inArray(appointment.status, upcomingStatuses), gt(appointment.startsAt, Date.now())))
    .orderBy(asc(appointment.startsAt), asc(appointment.id))
    .limit(scenarioCount)
    .all();
  return {
    ok: true as const,
    scenarios: rows
      .filter((row) => (row.guardianPhone ?? row.phone) !== null)
      .map((row) => ({
        appointmentId: row.appointmentId,
        startsAt: row.startsAt,
        patient: `${row.chosenName ?? row.firstName} ${row.lastName}`,
        practitioner: row.practitionerName,
      })),
  };
}

/** What the sandbox's reminder says when the organization has no template timed before an appointment. */
const fallbackReminder =
  "Hola {{paciente}}, te escribimos de {{organizacion}} para recordarte tu turno con {{profesional}} del {{fecha}} a las {{hora}}. Respondé este mensaje para confirmar que venís.";

/**
 * The template the scenario's reminder is: the furthest before the
 * appointment its medical service picks, else the organization's furthest;
 * `null` when it has none timed before an appointment.
 */
export function reminderTemplate(database: Database, medicalServiceId: string) {
  const timedBefore = database
    .select({ id: template.id, draft: template.draft, picked: medicalServiceTemplate.templateId })
    .from(template)
    .leftJoin(
      medicalServiceTemplate,
      and(
        eq(medicalServiceTemplate.templateId, template.id),
        eq(medicalServiceTemplate.medicalServiceId, medicalServiceId),
      ),
    )
    .where(eq(template.timing, "before"))
    .orderBy(desc(template.timingHours))
    .all();
  return timedBefore.find((one) => one.picked !== null) ?? timedBefore[0] ?? null;
}

/** The reminder the scenario starts from, as the patient read it: the approved template, or its draft. */
function reminderOf(database: Database, scenario: NonNullable<ReturnType<typeof scenarioOf>>) {
  const reminder = reminderTemplate(database, scenario.medicalServiceId);
  const body =
    (reminder && (approvedVersion(database, reminder.id)?.body ?? reminder.draft)) ??
    fallbackReminder;
  const values = templateValues({
    patient: scenario,
    practitionerName: scenario.practitionerName,
    start: new Date(scenario.startsAt),
    officeAddress: scenario.officeAddress,
    medicalServiceName: scenario.medicalServiceName,
    organizationName: organizationName(database),
  });
  return { templateId: reminder?.id ?? null, text: fillTemplate(body.trim(), values).text };
}

/** A sandbox conversation for `appointmentId`, its reminder just sent. */
export function startSandbox(database: Database, input: SandboxStart) {
  const parsed = sandboxStartSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" } as const;
  }
  const scenario = scenarioOf(database, parsed.data.appointmentId);
  if (!scenario) {
    return { ok: false, reason: "notFound" } as const;
  }
  const sandbox: SandboxState = {
    conversationId: crypto.randomUUID(),
    appointmentId: scenario.appointmentId,
    messages: [
      {
        direction: "outgoing",
        text: reminderOf(database, scenario).text,
        sentAt: Date.now(),
        judgement: null,
      },
    ],
    misunderstandings: 0,
    proposals: [],
    handoffs: [],
  };
  return { ok: true, sandbox } as const;
}
