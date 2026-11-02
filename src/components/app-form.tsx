import { createFormHook, createFormHookContexts, useStore } from "@tanstack/react-form";
import type { AnyFormApi } from "@tanstack/react-form";
import type { ComponentProps, ReactNode } from "react";

import { Checkbox } from "#/components/ui/checkbox.tsx";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "#/components/ui/field.tsx";
import { Input } from "#/components/ui/input.tsx";
import { NativeSelect } from "#/components/ui/native-select.tsx";

// The form kit: `useAppForm` holds a form's values, and each field below reads
// and writes its own through `form.AppField`. Number inputs hold their text, as
// typed: the form's schema decides what it is worth when it submits.

const { fieldContext, formContext, useFieldContext } = createFormHookContexts();

const hintIdFor = (name: string, hint?: string) => (hint ? `${name}-hint` : undefined);

type InputProps = Pick<
  ComponentProps<typeof Input>,
  "type" | "required" | "autoComplete" | "min" | "max" | "step" | "placeholder"
>;

function TextField(
  props: InputProps & {
    label: string;
    hint?: string;
    /** In a `flex` row of fields, where it takes its own width. */
    inline?: boolean;
    /** For a short number, narrower than its field. */
    narrow?: boolean;
  },
) {
  const { label, hint, inline, narrow, ...input } = props;
  const field = useFieldContext<string>();
  const hintId = hintIdFor(field.name, hint);
  return (
    <Field className={inline ? "w-auto" : undefined}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Input
        {...input}
        id={field.name}
        name={field.name}
        className={narrow ? "w-32 max-w-32" : undefined}
        value={field.state.value}
        onChange={(event) => field.handleChange(event.target.value)}
        onBlur={field.handleBlur}
        aria-describedby={hintId}
      />
      {hintId && <FieldDescription id={hintId}>{hint}</FieldDescription>}
    </Field>
  );
}

function SelectField(props: {
  label: string;
  required?: boolean;
  /** What sits beside the select, such as a colour's swatch. */
  beside?: ReactNode;
  children: ReactNode;
}) {
  const field = useFieldContext<string>();
  return (
    <Field>
      <FieldLabel htmlFor={field.name}>{props.label}</FieldLabel>
      <div className="flex items-center gap-3">
        <NativeSelect
          id={field.name}
          name={field.name}
          required={props.required}
          value={field.state.value}
          onChange={(event) => field.handleChange(event.target.value)}
          onBlur={field.handleBlur}
        >
          {props.children}
        </NativeSelect>
        {props.beside}
      </div>
    </Field>
  );
}

/** Whether the form is saving: a fieldset disables native inputs, not `Checkbox`. */
const useSubmitting = (form: AnyFormApi) => useStore(form.store, (state) => state.isSubmitting);

function CheckboxField(props: { label: string }) {
  const field = useFieldContext<boolean>();
  const submitting = useSubmitting(field.form);
  return (
    <Field orientation="horizontal" className="w-fit">
      <Checkbox
        id={field.name}
        checked={field.state.value}
        disabled={submitting}
        onCheckedChange={(checked) => field.handleChange(checked)}
      />
      <FieldLabel htmlFor={field.name}>{props.label}</FieldLabel>
    </Field>
  );
}

interface Option {
  value: string;
  label: string;
}

/** The picks in the options' order: the same picks always compare as the same value. */
export function pickedIn(options: Option[], picked: readonly string[]): string[] {
  return options.map((option) => option.value).filter((value) => picked.includes(value));
}

/** Several options picked in place; `row` lays short ones side by side. */
function CheckboxGroupField(props: { legend: string; options: Option[]; row?: boolean }) {
  const field = useFieldContext<string[]>();
  const submitting = useSubmitting(field.form);
  const picked = field.state.value;

  function toggle(value: string, checked: boolean) {
    const others = picked.filter((one) => one !== value);
    field.handleChange(pickedIn(props.options, checked ? [...others, value] : others));
  }

  return (
    <FieldSet>
      <FieldLegend variant="label">{props.legend}</FieldLegend>
      <FieldGroup
        data-slot="checkbox-group"
        className={props.row ? "flex-row flex-wrap" : undefined}
      >
        {props.options.map((option) => {
          const id = `${field.name}-${option.value}`;
          return (
            <Field key={option.value} orientation="horizontal" className="w-fit">
              <Checkbox
                id={id}
                checked={picked.includes(option.value)}
                disabled={submitting}
                onCheckedChange={(checked) => toggle(option.value, checked)}
              />
              <FieldLabel htmlFor={id}>{option.label}</FieldLabel>
            </Field>
          );
        })}
      </FieldGroup>
    </FieldSet>
  );
}

export const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField, SelectField, CheckboxField, CheckboxGroupField },
  formComponents: {},
});
