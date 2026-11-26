// The organization object as the assistant's tools see it, scripted from a case:
// every tool answers from world.ts, and nothing is written anywhere.

import { assistantToolSchemas } from "#/lib/assistant.ts";

import type { Case, HandoffReason, Proposal, ToolName } from "./cases.ts";
import { bookingSlots, medicalServices, numbers, type Appointment, type Slot } from "./world.ts";

const newPatientNameSchema =
  assistantToolSchemas.propose_booking.inputSchema.shape.newPatientName.unwrap();

export type ToolCall = { name: ToolName; args: Record<string, unknown>; result: object };

// A booking proposal: the patient, or the name of a person the practice does
// not know, and a time find_booking_times offered.
type Booking = { kind: "book"; patientId: string | null; newPatient?: string; slotId: string };

export type FakeObject = {
  run(name: ToolName, args: Record<string, unknown>): object;
  calls: ToolCall[];
  // Every time the turn's tools showed the model, the only times it may offer.
  knownTimes: Set<string>;
};

export function fakeObject(evaluationCase: Case): FakeObject {
  const patients = numbers[evaluationCase.number];
  const appointments = patients.flatMap((patient) => patient.appointments);
  const calls: ToolCall[] = [];
  const knownTimes = new Set<string>();
  let latest: Proposal | Booking | undefined = evaluationCase.liveProposal;
  let proposals = 0;

  const appointment = (id: unknown): Appointment | undefined =>
    appointments.find((each) => each.appointmentId === id);

  const describe = (proposal: Proposal, target: Appointment) => {
    const slot = target.freeSlots.find((each) => each.slotId === proposal.slotId);
    return {
      kind: proposal.kind,
      service: target.service,
      practitioner: target.practitioner,
      from: { date: target.date, time: target.time },
      to: slot ? { date: slot.date, time: slot.time } : undefined,
    };
  };

  const bookingSlot = (slotId: unknown) =>
    Object.entries(bookingSlots)
      .flatMap(([service, slots]) => slots.map((slot) => ({ service, ...slot })))
      .find((slot) => slot.slotId === slotId);

  const describeBooking = (booking: Booking) => {
    const slot = bookingSlot(booking.slotId);
    return {
      kind: booking.kind,
      medicalService: slot?.service,
      practitioner: slot?.practitioner,
      date: slot?.date,
      time: slot?.time,
      ...(booking.newPatient && { newPatient: booking.newPatient }),
    };
  };

  // Who a booking is for, as propose_booking settles it.
  const bookedFor = ({ patientId, newPatientName }: Record<string, unknown>) => {
    const named = newPatientNameSchema.safeParse(newPatientName);
    if (named.success) {
      const { firstName, lastName } = named.data;
      return { ok: true, patientId: null, newPatient: `${firstName} ${lastName}` };
    }
    const chosen = patientId ?? (patients.length === 1 ? patients[0]?.patientId : undefined);
    if (chosen === undefined)
      return { ok: false, reason: patients.length === 0 ? "nameNeeded" : "patientNotChosen" };
    const patient = patients.find((each) => each.patientId === chosen);
    return patient ? { ok: true, patientId: patient.patientId } : { ok: false, reason: "notFound" };
  };

  const handlers: Record<ToolName, (args: Record<string, unknown>) => object> = {
    list_patients: () => {
      for (const each of appointments) knownTimes.add(each.time);
      return {
        patients: patients.map((patient) => ({
          patientId: patient.patientId,
          firstName: patient.firstName,
          upcomingAppointments: patient.appointments.map((each) => ({
            appointmentId: each.appointmentId,
            date: each.date,
            time: each.time,
            status: each.status,
            medicalService: each.service,
            specialty: each.specialty,
          })),
        })),
      };
    },
    get_appointment: ({ appointmentId }) => {
      const found = appointment(appointmentId);
      if (!found) return { ok: false, reason: "not_found" };
      knownTimes.add(found.time);
      const { freeSlots: _slots, moveRefusal: _refusal, ...details } = found;
      return { ok: true, appointment: details };
    },
    list_medical_services: () => ({ medicalServices }),
    find_booking_times: ({ medicalService, practitioner, from }) => {
      const slots = bookingSlots[String(medicalService)];
      if (!slots) return { ok: false, reason: "notFound" };
      const offered = slots.filter(
        (slot) =>
          (practitioner === undefined || slot.practitioner === practitioner) &&
          slot.date >= String(from).slice(0, 10),
      );
      for (const slot of offered) knownTimes.add(slot.time);
      return { ok: true, medicalService, slots: offered, more: false };
    },
    find_free_times: ({ appointmentId }) => {
      const found = appointment(appointmentId);
      if (!found) return { ok: false, reason: "not_found" };
      if (found.status === "cancelled_by_organization")
        return { ok: false, reason: "cancelled_by_organization" };
      if (found.moveRefusal) return { ok: false, reason: found.moveRefusal };
      const offered = evaluationCase.slotTaken
        ? found.freeSlots.filter((slot) => slot.slotId !== latest?.slotId)
        : found.freeSlots;
      for (const slot of offered) knownTimes.add(slot.time);
      return { ok: true, practitioner: found.practitioner, slots: offered };
    },
    propose_change: (args) => {
      const target = appointment(args.appointmentId);
      if (!target) return { ok: false, reason: "not_found" };
      const kind = args.kind as Proposal["kind"];
      if (kind === "move") {
        if (target.moveRefusal) return { ok: false, reason: target.moveRefusal };
        const slot: Slot | undefined = target.freeSlots.find((each) => each.slotId === args.slotId);
        if (!slot) return { ok: false, reason: "unknown_slot" };
        knownTimes.add(slot.time);
      }
      if (target.status === "cancelled_by_organization")
        return { ok: false, reason: "cancelled_by_organization" };
      proposals += 1;
      latest = { kind, appointmentId: target.appointmentId, slotId: args.slotId as string };
      return { ok: true, proposalId: `prop-${proposals}`, proposal: describe(latest, target) };
    },
    propose_booking: (args) => {
      const forWhom = bookedFor(args);
      if (!forWhom.ok) return { ok: false, reason: forWhom.reason };
      const slot = bookingSlot(args.slotId);
      if (!slot) return { ok: false, reason: "notFree" };
      knownTimes.add(slot.time);
      const { patientId = null, newPatient } = forWhom;
      latest = { kind: "book", patientId, newPatient, slotId: slot.slotId };
      const patient = patients.find((each) => each.patientId === patientId);
      const alreadyBooked = (patient?.appointments ?? [])
        .filter((each) => each.date === slot.date && each.status !== "cancelled_by_organization")
        .map((each) => ({
          date: each.date,
          time: each.time,
          practitioner: each.practitioner,
          overlaps: each.time === slot.time,
        }));
      return { ok: true, proposal: describeBooking(latest), alreadyBooked };
    },
    accept_proposal: () => {
      if (!latest) return { ok: false, reason: "no_live_proposal" };
      if ((latest.kind === "move" || latest.kind === "book") && evaluationCase.slotTaken)
        return { ok: false, reason: "slot_taken" };
      if (latest.kind === "book") return { ok: true, applied: describeBooking(latest) };
      const target = appointment(latest.appointmentId);
      return target
        ? { ok: true, applied: describe(latest, target) }
        : { ok: false, reason: "not_found" };
    },
    hand_off: (args) => ({
      ok: true,
      reason: args.reason as HandoffReason,
      recipient:
        args.reason === "clinical" || args.reason === "emergency"
          ? "the appointment's practitioner"
          : "the handoff contacts",
    }),
    judge_messages: () => ({ ok: true }),
  };

  return {
    calls,
    knownTimes,
    run(name, args) {
      const result = handlers[name](args);
      calls.push({ name, args, result });
      return result;
    },
  };
}
