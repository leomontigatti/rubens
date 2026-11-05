import { AsyncLocalStorage } from "node:async_hooks";

/** Per-request counters, reported in the Server-Timing header by src/server.ts. */
export interface RequestStats {
  objectCalls: number;
  rowsRead: number;
  rowsWritten: number;
  objectMs: number;
  d1Queries: number;
  /** D1 statements the Worker itself prepared (Better Auth's session lookup). */
  workerD1Queries: number;
}

export const requestStats = new AsyncLocalStorage<RequestStats>();

export function record(stats: {
  rowsRead: number;
  rowsWritten: number;
  objectMs: number;
  d1Queries: number;
}) {
  const current = requestStats.getStore();
  if (!current) return;
  current.objectCalls++;
  current.rowsRead += stats.rowsRead;
  current.rowsWritten += stats.rowsWritten;
  current.objectMs += stats.objectMs;
  current.d1Queries += stats.d1Queries;
}

/** The D1 binding, counting each prepared statement into the request's stats. */
export function countingD1(db: D1Database): D1Database {
  return new Proxy(db, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === "prepare") {
        return (query: string) => {
          const current = requestStats.getStore();
          if (current) current.workerD1Queries++;
          return target.prepare(query);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
