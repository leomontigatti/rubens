import type * as z from "zod";

/** One refused field of a form, in the form's own copy. */
export interface FieldProblem {
  /** The form's field; empty for a problem about no field. */
  field: string;
  message: string;
  /** Left out of the summary: something else on the page already says it. */
  unsummarized?: boolean;
}

type Issue = z.core.$ZodIssue;

/** The copy for a field's problem from `messages`, by the schema's key. */
export function messageIn(messages: Record<string, string>) {
  return (issue: Issue) => messages[String(issue.path.at(-1))] ?? "Revisá los datos ingresados.";
}

/**
 * What a schema refused, one problem per field, in the schema's order: each
 * message comes from `messageOf`, never from Zod. `names` gives a schema's key
 * the name the form holds it under.
 */
export function fieldProblems(
  issues: readonly Issue[],
  messageOf: (issue: Issue) => string,
  names: Record<string, string> = {},
): FieldProblem[] {
  const problems = new Map<string, string>();
  for (const issue of issues) {
    const key = String(issue.path.at(-1) ?? "");
    const field = names[key] ?? key;
    if (!problems.has(field)) {
      problems.set(field, messageOf(issue));
    }
  }
  return [...problems].map(([field, message]) => ({ field, message }));
}
