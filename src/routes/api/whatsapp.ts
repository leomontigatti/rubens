import { createFileRoute } from "@tanstack/react-router";

import { handleWhatsappWebhook } from "#/server/whatsapp-webhook.ts";
import { workerEnv } from "#/server/with-organization.ts";

export const Route = createFileRoute("/api/whatsapp")({
  server: {
    handlers: {
      GET: ({ request }) => handleWhatsappWebhook(request, workerEnv),
      POST: ({ request }) => handleWhatsappWebhook(request, workerEnv),
    },
  },
});
