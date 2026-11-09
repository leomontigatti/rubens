import { integer, text } from "drizzle-orm/sqlite-core";

// The column kinds the organization object's tables share (`schema.ts`,
// `whatsapp-schema.ts`).

export const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

export const instant = (name: string) => integer(name, { mode: "number" });

export const flag = (name: string) => integer(name, { mode: "boolean" });

export const timestamps = {
  createdAt: instant("created_at")
    .notNull()
    .$defaultFn(() => Date.now()),
  updatedAt: instant("updated_at")
    .notNull()
    .$defaultFn(() => Date.now())
    .$onUpdateFn(() => Date.now()),
};
