import { createFormHook } from "@tanstack/react-form";
import { LockIcon } from "lucide-react";
import { useRef } from "react";
import type { ComponentProps, ReactNode } from "react";

import { ComboboxField, MultiComboboxField } from "#/components/combobox-fields.tsx";
import { DateInput, TimeInput } from "#/components/date-time-input.tsx";
import {
  FieldHint,
  fieldContext,
  formContext,
  joinIds,
  pickedIn,
  useFieldContext,
  useSubmitting,
} from "#/components/form-fields.tsx";
import { placeAttributes } from "#/components/field-size.ts";
import type { FieldPlace } from "#/components/field-size.ts";
import { FieldProblemText, useFieldId, useFieldProblem } from "#/components/field-problem.tsx";
import { InsertChips } from "#/components/insert-chips.tsx";
import { OptionSelect } from "#/components/option-select.tsx";
import type { SelectOption } from "#/components/option-select.tsx";
import type { TextInserts } from "#/components/insert-chips.tsx";
import { PhoneField } from "#/components/phone-field.tsx";

import { Checkbox } from "#/components/ui/checkbox.tsx";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "#/components/ui/field.tsx";
import { Input } from "#/components/ui/input.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "#/components/ui/input-group.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";

// The form kit: `useAppForm` holds a form's values, and each field below reads
// and writes its own through `form.AppField`. Number inputs hold their text, as
// typed: the form's schema decides what it is worth when it submits. Each
// field takes a `size` in its form's `FormGrid` (`field-size.ts`): a quarter
// of the row, or the whole row for what holds a list or a long text.

type InputProps = Pick<
  ComponentProps<typeof Input>,
  "required" | "readOnly" | "autoComplete" | "min" | "max" | "step" | "placeholder" | "maxLength"
> & {
  /** A date or a time is a `DateField` or a `TimeField`, which every browser shows alike. */
  type?: "text" | "email" | "tel" | "number" | "password";
};

/**
 * The fields of a form, in rows by their size, as wide as the form is (not the
 * window): one column below 448px, then six, where a quarter or a third takes
 * half the row, then twelve from 900px, where a quarter holds a date and time
 * (213px) and three thirds share a row.
 * A child that is no field (a section, an alert, a line of text) takes the
 * whole row: the attribute selectors outweigh `&>*`, and the row start
 * outweighs the span's shorthand, whatever order the stylesheet writes them in.
 */
export function FormGrid(props: Omit<ComponentProps<typeof FieldSet>, "className">) {
  return (
    <div className="@container">
      <FieldSet
        className="grid grid-cols-1 @md:grid-cols-6 @md:[&>*]:col-span-6 @md:[&>[data-size=quarter]]:col-span-3 @md:[&>[data-size=third]]:col-span-3 @md:[&>[data-size][data-starts-row]]:col-start-1 @[56.25rem]:grid-cols-12 @[56.25rem]:[&>*]:col-span-12 @[56.25rem]:[&>[data-size=half]]:col-span-6 @[56.25rem]:[&>[data-size=third]]:col-span-4"
        {...props}
      />
    </div>
  );
}

function TextField(props: InputProps & FieldPlace & { label: string; hint?: string }) {
  const { label, hint, size, startsRow, ...input } = props;
  const field = useFieldContext<string>();
  const { problem, errorId, invalid } = useFieldProblem(field.name);
  const id = useFieldId(field.name);
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <Field {...placeAttributes({ size, startsRow }, "quarter")} data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {input.readOnly ? (
        // A value the form shows but cannot change: muted, with a lock.
        <InputGroup>
          <InputGroupInput
            {...input}
            id={id}
            name={field.name}
            value={field.state.value}
            aria-describedby={hintId}
          />
          <InputGroupAddon align="inline-end">
            <LockIcon aria-hidden className="size-3" />
          </InputGroupAddon>
        </InputGroup>
      ) : (
        <Input
          {...input}
          id={id}
          name={field.name}
          value={field.state.value}
          onChange={(event) => field.handleChange(event.target.value)}
          onBlur={field.handleBlur}
          aria-invalid={invalid}
          aria-describedby={joinIds(hintId, errorId)}
        />
      )}
      <FieldHint id={hintId}>{hint}</FieldHint>
      <FieldProblemText id={errorId}>{problem}</FieldProblemText>
    </Field>
  );
}

/** A date or a time, typed or picked: `DateInput` and `TimeInput` say how. */
function typedField(Box: typeof DateInput | typeof TimeInput) {
  return function TypedField(
    props: FieldPlace & { label: string; hint?: string; required?: boolean },
  ) {
    const field = useFieldContext<string>();
    const { problem, errorId, invalid } = useFieldProblem(field.name);
    const id = useFieldId(field.name);
    const hintId = props.hint ? `${id}-hint` : undefined;
    return (
      <Field {...placeAttributes(props, "quarter")} data-invalid={invalid}>
        <FieldLabel htmlFor={id}>{props.label}</FieldLabel>
        <Box
          id={id}
          value={field.state.value}
          onChange={field.handleChange}
          onBlur={field.handleBlur}
          required={props.required}
          aria-invalid={invalid}
          aria-describedby={joinIds(hintId, errorId)}
        />
        <FieldHint id={hintId}>{props.hint}</FieldHint>
        <FieldProblemText id={errorId}>{problem}</FieldProblemText>
      </Field>
    );
  };
}

/** A date, typed as `dd/mm/aaaa` or picked on the calendar; the form holds `YYYY-MM-DD`. */
const DateField = typedField(DateInput);

/** A time on a 24-hour clock, typed as `HH:mm`; the form holds `HH:MM`. */
const TimeField = typedField(TimeInput);

/** A long text, such as a message body, whose box grows with what it holds. */
function TextareaField(
  props: FieldPlace & {
    label: string;
    hint?: string;
    required?: boolean;
    /** What sits under the hint, such as the text as it will be sent. */
    preview?: ReactNode;
    /** The chips above the box, each writing its text in at the cursor, and what the row is called. */
    inserts?: TextInserts;
  },
) {
  const { label, hint, required, preview, inserts } = props;
  const field = useFieldContext<string>();
  const { problem, errorId, invalid } = useFieldProblem(field.name);
  const id = useFieldId(field.name);
  const hintId = hint ? `${id}-hint` : undefined;
  const box = useRef<HTMLTextAreaElement>(null);

  return (
    <Field {...placeAttributes(props, "full")} data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {inserts && (
        <InsertChips
          {...inserts}
          box={box}
          value={field.state.value}
          onChange={field.handleChange}
        />
      )}
      <Textarea
        ref={box}
        id={id}
        name={field.name}
        required={required}
        value={field.state.value}
        onChange={(event) => field.handleChange(event.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={invalid}
        aria-describedby={joinIds(hintId, errorId)}
      />
      <FieldHint id={hintId}>{hint}</FieldHint>
      {preview}
      <FieldProblemText id={errorId}>{problem}</FieldProblemText>
    </Field>
  );
}

/**
 * A choice from `options` (shadcn's `Select`, through `OptionSelect`). `""` is
 * no choice: an option may name it, or `placeholder` shows in the box.
 */
function SelectField(
  props: FieldPlace & {
    label: string;
    hint?: string;
    required?: boolean;
    options: SelectOption[];
    placeholder?: string;
  },
) {
  const field = useFieldContext<string>();
  const submitting = useSubmitting(field.form);
  const { problem, errorId, invalid } = useFieldProblem(field.name);
  const id = useFieldId(field.name);
  const hintId = props.hint ? `${id}-hint` : undefined;
  return (
    <Field {...placeAttributes(props, "quarter")} data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{props.label}</FieldLabel>
      <OptionSelect
        id={id}
        options={props.options}
        placeholder={props.placeholder}
        required={props.required}
        disabled={submitting}
        value={field.state.value}
        onValueChange={(value) => field.handleChange(value)}
        onBlur={field.handleBlur}
        aria-invalid={invalid}
        aria-describedby={joinIds(hintId, errorId)}
      />
      <FieldHint id={hintId}>{props.hint}</FieldHint>
      <FieldProblemText id={errorId}>{problem}</FieldProblemText>
    </Field>
  );
}

interface MarkedOption {
  value: string;
  label: string;
  mark: ReactNode;
}

/**
 * A select whose options each show their mark, in the list and in the box: a
 * native select cannot draw one inside its options.
 */
function MarkedSelectField(props: FieldPlace & { label: string; options: MarkedOption[] }) {
  const field = useFieldContext<string>();
  const submitting = useSubmitting(field.form);
  const { problem, errorId, invalid } = useFieldProblem(field.name);
  const id = useFieldId(field.name);
  const shown = (value: unknown) => props.options.find((option) => option.value === value);
  return (
    <Field {...placeAttributes(props, "quarter")} data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{props.label}</FieldLabel>
      <Select
        value={field.state.value}
        onValueChange={(value) => field.handleChange(String(value))}
        disabled={submitting}
      >
        <SelectTrigger
          id={id}
          onBlur={field.handleBlur}
          aria-invalid={invalid}
          aria-describedby={errorId}
        >
          <SelectValue>{(value) => <MarkedLabel option={shown(value)} />}</SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {props.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <MarkedLabel option={option} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldProblemText id={errorId}>{problem}</FieldProblemText>
    </Field>
  );
}

function MarkedLabel({ option }: { option: MarkedOption | undefined }) {
  return option ? (
    <>
      {option.mark}
      {option.label}
    </>
  ) : null;
}

function CheckboxField(props: FieldPlace & { label: string }) {
  const field = useFieldContext<boolean>();
  const submitting = useSubmitting(field.form);
  const { problem, errorId, invalid } = useFieldProblem(field.name);
  const id = useFieldId(field.name);
  return (
    <Field {...placeAttributes(props, "quarter")} data-invalid={invalid}>
      <Field orientation="horizontal" className="w-fit">
        <Checkbox
          id={id}
          checked={field.state.value}
          disabled={submitting}
          aria-invalid={invalid}
          aria-describedby={errorId}
          onCheckedChange={(checked) => field.handleChange(checked)}
        />
        <FieldLabel htmlFor={id}>{props.label}</FieldLabel>
      </Field>
      <FieldProblemText id={errorId}>{problem}</FieldProblemText>
    </Field>
  );
}

/** Several options picked in place; `row` lays short ones side by side. */
function CheckboxGroupField(
  props: FieldPlace & { legend: string; options: SelectOption[]; row?: boolean },
) {
  const field = useFieldContext<string[]>();
  const submitting = useSubmitting(field.form);
  const { problem, errorId, invalid } = useFieldProblem(field.name);
  const id = useFieldId(field.name);
  const picked = field.state.value;

  function toggle(value: string, checked: boolean) {
    const others = picked.filter((one) => one !== value);
    field.handleChange(pickedIn(props.options, checked ? [...others, value] : others));
  }

  return (
    <FieldSet {...placeAttributes(props, "full")} id={id} data-invalid={invalid}>
      <FieldLegend variant="label">{props.legend}</FieldLegend>
      <FieldGroup
        data-slot="checkbox-group"
        className={props.row ? "flex-row flex-wrap" : undefined}
      >
        {props.options.map((option) => {
          const optionId = `${id}-${option.value}`;
          return (
            <Field key={option.value} orientation="horizontal" className="w-fit">
              <Checkbox
                id={optionId}
                checked={picked.includes(option.value)}
                disabled={submitting}
                aria-invalid={invalid}
                aria-describedby={errorId}
                onCheckedChange={(checked) => toggle(option.value, checked)}
              />
              <FieldLabel htmlFor={optionId}>{option.label}</FieldLabel>
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
  fieldComponents: {
    TextField,
    PhoneField,
    DateField,
    TimeField,
    TextareaField,
    SelectField,
    MarkedSelectField,
    CheckboxField,
    CheckboxGroupField,
    ComboboxField,
    MultiComboboxField,
  },
  formComponents: {},
});
