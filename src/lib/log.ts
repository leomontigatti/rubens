// The app's one way to log (`no-console` in vite.config.ts), so each line reaches
// Workers Logs as fields it can filter by. A field holds an id, a count or a code,
// never patient data (docs/agents/coding-standards.md#underthing-rules).

type LogFields = Record<string, string | number | boolean | null>;

/** What a caught value was, by its class alone: its message can quote patient data or Meta's answer. */
export function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export const log = {
  warn: (tag: string, message: string, fields: LogFields = {}) =>
    console.warn({ ...fields, tag, message }),
  error: (tag: string, message: string, fields: LogFields = {}) =>
    console.error({ ...fields, tag, message }),
};
