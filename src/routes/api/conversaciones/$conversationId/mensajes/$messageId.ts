import { createFileRoute } from "@tanstack/react-router";

import { clerkSession, resolveCaller } from "#/server/caller.ts";
import { serveMessageMedia } from "#/server/message-media.ts";
import { currentAuthMode, workerEnv } from "#/server/with-organization.ts";

// A patient's media in a conversation, streamed from Meta (`src/server/message-media.ts`).
export const Route = createFileRoute("/api/conversaciones/$conversationId/mensajes/$messageId")({
  server: {
    handlers: {
      GET: async ({ request, params }) =>
        serveMessageMedia(
          await resolveCaller(request, workerEnv, currentAuthMode(), clerkSession(workerEnv)),
          // The router's params are not a plain object, which RPC cannot clone.
          { conversationId: params.conversationId, messageId: params.messageId },
        ),
    },
  },
});
