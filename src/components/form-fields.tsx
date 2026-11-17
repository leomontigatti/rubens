import { createFormHookContexts } from "@tanstack/react-form";

import { FieldDescription } from "#/components/ui/field.tsx";

// What the form kit's fields share: the contexts a field reads its value
// through, and the parts of its markup. Apart from `app-form.tsx`, so a field
// in a file of its own (`phone-field.tsx`) reads them without importing the kit
// that registers it.

export const { fieldContext, formContext, useFieldContext } = createFormHookContexts();

export const joinIds = (...ids: (string | undefined)[]) =>
  ids.filter(Boolean).join(" ") || undefined;

/** The hint a field's input points at, when it has one. */
export function FieldHint(props: { id?: string; children?: string }) {
  return props.id ? <FieldDescription id={props.id}>{props.children}</FieldDescription> : null;
}
