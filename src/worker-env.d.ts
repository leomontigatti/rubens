import type { WorkerEnv } from "#/server/caller.ts";

// The type of `env` from `cloudflare:workers` and from `cloudflare:test`, and of
// each Durable Object's constructor argument: the app's one env type.
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
