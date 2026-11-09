// The assistant's real system prompt (`src/lib/assistant.ts`, #169, #171, #173, #174),
// stated for the evaluation's world.

import { assistantSystemPrompt } from "../../../src/lib/assistant.ts";

import { now, organization, timeZone } from "./world.ts";

export function systemPrompt(): string {
  return assistantSystemPrompt({
    organizationName: organization.name,
    now: new Date(now),
    timeZone,
    formOfAddress: "vos",
    tone: "",
  });
}
