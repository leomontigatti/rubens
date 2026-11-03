import { describe, expect, it } from "vite-plus/test";
import * as z from "zod";

import { fieldProblems } from "#/components/form-problems.ts";

const schema = z.object({
  name: z.string().min(1),
  entry: z.object({ lastDate: z.string().min(1) }),
  officeId: z.string().min(1),
  notes: z.string().min(1).max(3),
});

const failed = (value: unknown) => schema.safeParse(value).error!.issues;

const copy = (issue: { path: PropertyKey[] }) => `Revisá ${String(issue.path.at(-1))}.`;

describe("fieldProblems", () => {
  it("names each refused field, nested ones by their last key", () => {
    const issues = failed({ name: "", entry: { lastDate: "" }, officeId: "x", notes: "a" });

    expect(fieldProblems(issues, copy)).toEqual([
      { field: "name", message: "Revisá name." },
      { field: "lastDate", message: "Revisá lastDate." },
    ]);
  });

  it("keeps a field's first problem", () => {
    const issues = [
      { code: "custom", path: ["name"], message: "first" },
      { code: "custom", path: ["name"], message: "second" },
    ] as z.core.$ZodIssue[];

    expect(fieldProblems(issues, (issue) => issue.message)).toEqual([
      { field: "name", message: "first" },
    ]);
  });

  it("gives a schema's name the form's own field name", () => {
    const issues = failed({ name: "a", entry: { lastDate: "b" }, officeId: "", notes: "a" });

    expect(fieldProblems(issues, copy, { officeId: "owner" })).toEqual([
      { field: "owner", message: "Revisá officeId." },
    ]);
  });

  it("gives a problem about no field an empty name, for the summary alone", () => {
    const issues = [{ code: "custom", path: [], message: "whole" }] as z.core.$ZodIssue[];

    expect(fieldProblems(issues, (issue) => issue.message)).toEqual([
      { field: "", message: "whole" },
    ]);
  });
});
