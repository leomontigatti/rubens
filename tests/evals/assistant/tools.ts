// The assistant's tools: the real schemas (`src/lib/assistant.ts`, #169,
// #171's hand_off, #173's proposals and #174's moves). Each runs against the
// case's fake object, so the model sees scripted results.

import { toolDefinition } from "@tanstack/ai";

import { assistantToolSchemas } from "../../../src/lib/assistant.ts";

import type { FakeObject } from "./fake-object.ts";

const real = Object.entries(assistantToolSchemas).map(([name, schema]) =>
  toolDefinition({ name, ...schema }),
);

export function assistantTools(object: FakeObject) {
  return real.map((definition) =>
    definition.server((args) =>
      object.run(
        definition.name as Parameters<FakeObject["run"]>[0],
        args as Record<string, unknown>,
      ),
    ),
  );
}
