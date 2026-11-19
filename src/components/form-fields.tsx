import { createFormHookContexts, useStore } from "@tanstack/react-form";
import type { AnyFormApi } from "@tanstack/react-form";

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

/** Whether the form is saving: a fieldset disables native inputs, not `Checkbox`. */
export const useSubmitting = (form: AnyFormApi) =>
  useStore(form.store, (state) => state.isSubmitting);

interface Option {
  value: string;
  label: string;
}

/** The picks in the options' order: the same picks always compare as the same value. */
export function pickedIn(options: Option[], picked: readonly string[]): string[] {
  return options.map((option) => option.value).filter((value) => picked.includes(value));
}
