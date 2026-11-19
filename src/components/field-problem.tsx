import { createContext, useContext } from "react";

import type { FieldProblem } from "#/components/form-problems.ts";
import { FieldError } from "#/components/ui/field.tsx";

// What a form's fields show of what the last submit refused: each field finds
// its own problem by name, and says it under itself.

/** What the last submit refused, which each field finds its own in. */
export const FormProblemsContext = createContext<FieldProblem[]>([]);

/**
 * What a form's field ids start with, so two forms on one page, such as a
 * `FormDialog` over a form page, never share one: none on a form page.
 */
export const FieldIdPrefixContext = createContext("");

/** The id of a field's input, which its label, hint and problem hang off. */
export function useFieldId(name: string) {
  return `${useContext(FieldIdPrefixContext)}${name}`;
}

/** A field's problem, and what its input needs to say so to a screen reader. */
export function useFieldProblem(name: string) {
  const id = useFieldId(name);
  const problem = useContext(FormProblemsContext).find((one) => one.field === name)?.message;
  return problem
    ? { problem, errorId: `${id}-error`, invalid: true as const }
    : { problem, errorId: undefined, invalid: undefined };
}

/** Under the field. No live region: focus moves to the first one, which reads it out. */
export function FieldProblemText(props: { id?: string; children?: string }) {
  return props.id ? (
    <FieldError id={props.id} role={undefined}>
      {props.children}
    </FieldError>
  ) : null;
}
