import handler from "@tanstack/react-start/server-entry";

import { type RequestStats, requestStats } from "./lib/request-stats";

export { OrganizationData } from "./org/organization-data";

/**
 * Start's handler, wrapped to report per request: wall time in the Worker (the body
 * is buffered so a streamed render is counted whole), Durable Object calls, SQLite
 * rows read and written.
 */
export default {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext) {
    const stats: RequestStats = {
      objectCalls: 0,
      rowsRead: 0,
      rowsWritten: 0,
      objectMs: 0,
    };
    const startedAt = performance.now();
    return requestStats.run(stats, async () => {
      const response = await handler.fetch(request, env as never, ctx as never);
      const body = response.body ? await response.arrayBuffer() : null;
      const total = performance.now() - startedAt;
      const headers = new Headers(response.headers);
      headers.append(
        "Server-Timing",
        [
          `worker;dur=${total.toFixed(2)}`,
          `object;dur=${stats.objectMs.toFixed(2)};desc="calls=${stats.objectCalls} rowsRead=${stats.rowsRead} rowsWritten=${stats.rowsWritten}"`,
        ].join(", "),
      );
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    });
  },
} satisfies ExportedHandler;
