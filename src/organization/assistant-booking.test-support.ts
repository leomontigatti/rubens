import { z } from "zod";

import {
  afterTheWait,
  patientWrites,
  scriptedModel,
} from "#/organization/assistant-model.test-support.ts";
import type { Organization } from "#/organization/organization.ts";

// A booking in the conversation as the assistant's tests play it
// (`docs/agents/tdd-db.md`): the turn that offers a time, the one that
// proposes it and the one that accepts it on the patient's yes, each with a
// scripted model. `organization.test-support.ts` re-exports them.

/** The judgement of a patient's message asking to book. */
const askingToBook = { healthQuestion: false, emergency: false, booking: true };

/** What find_booking_times returns: the free times offered. */
const bookingTimesOffered = z.looseObject({
  slots: z.array(z.looseObject({ slotId: z.string(), date: z.string(), time: z.string() })),
});

/**
 * Runs a turn from `phone` that asks for times of the "Consulta" from Monday
 * 5 January, and returns the slotId offered for `time` on `date`.
 */
export async function offeredBookingSlot(
  organization: DurableObjectStub<Organization>,
  phone: string,
  { date, time }: { date: string; time: string },
) {
  await patientWrites(organization, "quiero un turno para una consulta", phone);
  let found: unknown;
  scriptedModel.script((one) => {
    one.call("judge_messages", askingToBook);
    found = one.call("find_booking_times", { medicalService: "Consulta", from: "2099-01-05" });
    return "Tengo estos horarios.";
  });
  await afterTheWait(organization);
  const offered = bookingTimesOffered
    .parse(found)
    .slots.find((one) => one.date === date && one.time === time);
  if (!offered) {
    throw new Error(`${date} ${time} was not offered`);
  }
  return offered.slotId;
}

/** Runs a turn from `phone` that proposes a booking with `args`, and returns what propose_booking gave. */
export async function proposesBooking(
  organization: DurableObjectStub<Organization>,
  phone: string,
  args: { slotId: string; patientId?: string; newPatientName?: object },
) {
  await patientWrites(organization, "el lunes 5 a las 10", phone);
  let proposed: unknown;
  scriptedModel.script((one) => {
    one.call("judge_messages", askingToBook);
    proposed = one.call("propose_booking", args);
    return "Te reservo la consulta con Juan Gómez el lunes 5 de enero a las 10:00. Te parece bien?";
  });
  await afterTheWait(organization);
  return proposed;
}

/** Runs a turn from `phone` on the patient's yes, and returns what accept_proposal gave. */
export async function acceptsProposal(
  organization: DurableObjectStub<Organization>,
  phone: string,
) {
  await patientWrites(organization, "sí", phone);
  let accepted: unknown;
  scriptedModel.script((one) => {
    one.call("judge_messages", askingToBook);
    accepted = one.call("accept_proposal");
    return "Listo, te reservé el turno.";
  });
  await afterTheWait(organization);
  return accepted;
}
