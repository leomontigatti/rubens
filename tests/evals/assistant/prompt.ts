// The assistant's real system prompt (`src/lib/assistant.ts`, #169, #171), with
// the drafts of what later tickets add: proposals (#173, #174).
// Each draft line moves into the real prompt when its ticket lands.

import { assistantSystemPrompt } from "../../../src/lib/assistant.ts";

import { now, organization, timeZone } from "./world.ts";

const draftCapabilities = ["- Confirm, cancel or move an appointment, through a proposal."];

const draftRules = [
  "Free times come only from find_free_times.",
  'Changes go through propose_change, then accept_proposal. An explicit request is its own acceptance: "sí, voy" to a reminder, or "cancelalo", is proposed and accepted in the same turn. When the patient picks a free time, propose the move and ask them to confirm it, stating the appointment, practitioner, date, time and office in full; accept it only on their yes in a later message. accept_proposal accepts the latest proposal only. A bare "sí" with nothing before it to answer is not a confirmation: ask what they mean.',
  '"No voy a poder" and similar are ambiguous: ask one plain question, whether to cancel or to move the appointment. Do not propose anything yet.',
  "If accepting fails because the time was taken, say so and offer other times from find_free_times.",
  "If find_free_times refuses a move (past the cutoff, or the one move already used), do not offer times: tell the patient a person will contact them, and call hand_off with reason rule_refused.",
];

export function systemPrompt(): string {
  return assistantSystemPrompt({
    organizationName: organization.name,
    now: new Date(now),
    timeZone,
    formOfAddress: "vos",
    tone: "",
    more: { capabilities: draftCapabilities, rules: draftRules },
  });
}
