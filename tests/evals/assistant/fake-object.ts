// The organization object as the assistant's tools see it, scripted from a case:
// every tool answers from world.ts, and nothing is written anywhere.

import type { Case, HandoffReason, Proposal, ToolName } from "./cases.ts";
import { numbers, type Appointment, type Slot } from "./world.ts";

export type ToolCall = { name: ToolName; args: Record<string, unknown>; result: unknown };

export type FakeObject = {
  run(name: ToolName, args: Record<string, unknown>): unknown;
  calls: ToolCall[];
  // Every time the turn's tools showed the model, the only times it may offer.
  knownTimes: Set<string>;
};

export function fakeObject(evaluationCase: Case): FakeObject {
  const patients = numbers[evaluationCase.number];
  const appointments = patients.flatMap((patient) => patient.appointments);
  const calls: ToolCall[] = [];
  const knownTimes = new Set<string>();
  let latest: Proposal | undefined = evaluationCase.liveProposal;
  let proposals = 0;

  const appointment = (id: unknown): Appointment | undefined =>
    appointments.find((each) => each.appointmentId === id);

  const describe = (proposal: Proposal, target: Appointment) => {
    const slot = target.freeSlots.find((each) => each.slotId === proposal.slotId);
    return {
      kind: proposal.kind,
      service: target.service,
      practitioner: target.practitioner,
      from: { date: target.date, time: target.time, office: target.office },
      to: slot ? { date: slot.date, time: slot.time, office: slot.office } : undefined,
    };
  };

  const handlers: Record<ToolName, (args: Record<string, unknown>) => unknown> = {
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
            practitioner: each.practitioner,
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
    accept_proposal: () => {
      if (!latest) return { ok: false, reason: "no_live_proposal" };
      if (latest.kind === "move" && evaluationCase.slotTaken)
        return { ok: false, reason: "slot_taken" };
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
