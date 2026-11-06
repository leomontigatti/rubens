import { clerkMiddleware } from "@clerk/tanstack-react-start/server";
import { createCsrfMiddleware, createStart } from "@tanstack/react-start";

// With this file, Start no longer adds its default CSRF middleware: it is added back here.
const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });

// This file is bundled for the browser too, so it cannot import `cloudflare:workers`. On the
// server, `nodejs_compat` fills `process.env` from the Worker's vars and secrets (and
// `.dev.vars` in dev), which is also where Clerk reads its keys.
const clerkConfigured = typeof process !== "undefined" && !!process.env?.CLERK_SECRET_KEY;

export const startInstance = createStart(() => ({
  requestMiddleware: clerkConfigured
    ? [csrf, clerkMiddleware({ signInUrl: "/ingresar" })]
    : [csrf],
}));
