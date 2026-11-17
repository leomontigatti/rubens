import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { byName } from "#/organization/name-order.ts";
import { patient } from "#/organization/schema.ts";

// The object's SQLite binds at most 100 parameters a query, and the notification
// list already binds up to 100 conversation ids beside its name order.
describe("the order of people's names", () => {
  it("binds no parameters, so a query that binds many ids stays under the object's limit", () => {
    const query = new SQLiteSyncDialect().sqlToQuery(
      sql.join(byName(patient.lastName, patient.firstName), sql`, `),
    );

    expect(query.params).toEqual([]);
  });
});
