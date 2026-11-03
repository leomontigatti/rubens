import { createFormHook, createFormHookContexts, useStore } from "@tanstack/react-form";
import type { AnyFormApi } from "@tanstack/react-form";
import { createContext, useContext } from "react";
import type { ComponentProps, ReactNode } from "react";

import type { FieldProblem } from "#/components/form-problems.ts";

import { Checkbox } from "#/components/ui/checkbox.tsx";
import {
  Field,
  FieldDescription,
  FieldError,
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

/** What the last submit refused, which each field finds its own in. */
export const FormProblemsContext = createContext<FieldProblem[]>([]);

const joinIds = (...ids: (string | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;

/** A field's problem, and what its input needs to say so to a screen reader. */
function useFieldProblem(name: string) {
  const problem = useContext(FormProblemsContext).find((one) => one.field === name)?.message;
  return problem
    ? { problem, errorId: `${name}-error`, invalid: true as const }
    : { problem, errorId: undefined, invalid: undefined };
}

/** The hint a field's input points at, when it has one. */
function FieldHint(props: { id?: string; children?: string }) {
  return props.id ? <FieldDescription id={props.id}>{props.children}</FieldDescription> : null;
}

/** Under the field. The summary above the form is what gets announced. */
function FieldProblemText(props: { id?: string; children?: string }) {
  return props.id ? (
    <FieldError id={props.id} role={undefined}>
      {props.children}
    </FieldError>
  ) : null;
}

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
  const { problem, errorId, invalid } = useFieldProblem(field.name);
  const hintId = hint ? `${field.name}-hint` : undefined;
  return (
    <Field className={inline ? "w-auto" : undefined} data-invalid={invalid}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Input
        {...input}
        id={field.name}
        name={field.name}
        className={narrow ? "w-32 max-w-32" : undefined}
        value={field.state.value}
        onChange={(event) => field.handleChange(event.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={invalid}
        aria-describedby={joinIds(hintId, errorId)}
      />
      <FieldHint id={hintId}>{hint}</FieldHint>
      <FieldProblemText id={errorId}>{problem}</FieldProblemText>
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
  const { problem, errorId, invalid } = useFieldProblem(field.name);
  const select = (
    <NativeSelect
      id={field.name}
      name={field.name}
      required={props.required}
      value={field.state.value}
      onChange={(event) => field.handleChange(event.target.value)}
      onBlur={field.handleBlur}
      aria-invalid={invalid}
      aria-describedby={errorId}
    >
      {props.children}
    </NativeSelect>
  );
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={field.name}>{props.label}</FieldLabel>
      {props.beside ? (
        <div className="flex items-center gap-3">
          {select}
          {props.beside}
        </div>
      ) : (
        select
      )}
      <FieldProblemText id={errorId}>{problem}</FieldProblemText>
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
  const { problem, errorId, invalid } = useFieldProblem(field.name);
  const picked = field.state.value;

  function toggle(value: string, checked: boolean) {
    const others = picked.filter((one) => one !== value);
    field.handleChange(pickedIn(props.options, checked ? [...others, value] : others));
  }

  return (
    <FieldSet id={field.name} data-invalid={invalid}>
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
                aria-invalid={invalid}
                aria-describedby={errorId}
                onCheckedChange={(checked) => toggle(option.value, checked)}
              />
              <FieldLabel htmlFor={id}>{option.label}</FieldLabel>
            </Field>
          );
        })}
      </FieldGroup>
      <FieldProblemText id={errorId}>{problem}</FieldProblemText>
    </FieldSet>
  );
}

export const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField, SelectField, CheckboxField, CheckboxGroupField },
  formComponents: {},
});
