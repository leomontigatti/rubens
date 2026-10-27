import { createFileRoute } from "@tanstack/react-router";
import { auth, handleAuthRequest } from "#/lib/auth.ts";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleAuthRequest(auth, request),
      POST: ({ request }) => handleAuthRequest(auth, request),
    },
  },
});
