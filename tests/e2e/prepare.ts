import { rmSync } from "node:fs";

import { e2e } from "./environment.ts";

// Clears the browser suite's object storage before every run. The build seeds
// the dev organization (`src/dev/seed.ts`, the data in
// `world.test-support.ts`) on the sign-in page's first load, so each run
// starts from a fresh seed. With `auth.setup.ts`, the only file of the suite
// that knows the backend: a port swaps these and no spec.

rmSync(e2e.stateDirectory, { recursive: true, force: true });
console.log(`e2e storage cleared: ${e2e.stateDirectory}`);
