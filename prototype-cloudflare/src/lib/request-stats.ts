import { AsyncLocalStorage } from "node:async_hooks";

/** Per-request counters, reported in the Server-Timing header by src/server.ts. */
export interface RequestStats {
  objectCalls: number;
  rowsRead: number;
  rowsWritten: number;
  objectMs: number;
}

export const requestStats = new AsyncLocalStorage<RequestStats>();

export function record(stats: {
  rowsRead: number;
  rowsWritten: number;
  objectMs: number;
}) {
  const current = requestStats.getStore();
  if (!current) return;
  current.objectCalls++;
  current.rowsRead += stats.rowsRead;
  current.rowsWritten += stats.rowsWritten;
  current.objectMs += stats.objectMs;
}
