// What an audit log entry keeps of a change (ADR-0003): the fields that
// changed, before and after, or the fields an entity was created with. Shared
// by the organization object's audit writer and the Postgres services the port
// (#131) has not moved yet.

/** A field's value as the log keeps it: a `Date` becomes its ISO string. */
export type AuditValue = string | number | boolean | null;

export type AuditValues = Record<string, AuditValue>;

/** An entity's fields, as the code that changes it reads them. */
type Fields = Record<string, AuditValue | Date | undefined>;

function comparable(value: AuditValue | Date | undefined): AuditValue {
  if (value === undefined) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * The fields that differ between `before` and `after`, each side holding only
 * those. `null` when nothing changed, so the caller writes no entry.
 */
export function changedFields(
  before: Fields,
  after: Fields,
): { before: AuditValues; after: AuditValues } | null {
  const changed = Object.keys(after).filter(
    (key) => comparable(before[key]) !== comparable(after[key]),
  );
  if (changed.length === 0) {
    return null;
  }
  return {
    before: Object.fromEntries(changed.map((key) => [key, comparable(before[key])])),
    after: Object.fromEntries(changed.map((key) => [key, comparable(after[key])])),
  };
}

/** The fields a new entity was created with: those holding a value. */
export function createdFields(values: Fields): AuditValues {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => [key, comparable(value)]),
  );
}
