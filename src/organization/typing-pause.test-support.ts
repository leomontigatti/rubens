import { vi } from "vite-plus/test";

import { fakeMeta } from "#/organization/graph-api.test-support.ts";

// The `workers` project's setup file, so every object test has it: the
// assistant's typing pause goes to the fake Meta, which records it and
// returns at once unless a test holds it (`holdTypingPause`), so a turn's
// reply does not wait seconds of real time.
vi.mock(import("#/organization/typing-pause.ts"), () => ({
  typingPause: (ms: number) => fakeMeta.typingPause(ms),
}));
