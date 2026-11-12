import { createFormHook, createFormHookContexts, useStore } from "@tanstack/react-form";
import type { AnyFormApi } from "@tanstack/react-form";
import { SearchIcon } from "lucide-react";
import { useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";

import { comboboxTextChange } from "#/components/combobox-text.ts";
import { DateInput, TimeInput } from "#/components/date-time-input.tsx";
import { placeAttributes } from "#/components/field-size.ts";
import type { FieldPlace } from "#/components/field-size.ts";
import { FieldProblemText, useFieldProblem } from "#/components/field-problem.tsx";
import { InsertChips } from "#/components/insert-chips.tsx";
import type { TextInserts } from "#/components/insert-chips.tsx";

import { Checkbox } from "#/components/ui/checkbox.tsx";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "#/components/ui/combobox.tsx";
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
import { InputGroupAddon } from "#/components/ui/input-group.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";

// The form kit: `useAppForm` holds a form's values, and each field below reads
// and writes its own through `form.AppField`. Number inputs hold their text, as
// typed: the form's schema decides what it is worth when it submits. Each
// field takes a `size` in its form's `FormGrid` (`field-size.ts`): a quarter
// of the row, or the whole row for what holds a list or a long text.

const { fieldContext, formContext, useFieldContext } = createFormHookContexts();

const joinIds = (...ids: (string | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;

/** The hint a field's input points at, when it has one. */
function FieldHint(props: { id?: string; children?: string }) {
  return props.id ? <FieldDescription id={props.id}>{props.children}</FieldDescription> : null;
}

type InputProps = Pick<
  ComponentProps<typeof Input>,
  "required" | "autoComplete" | "min" | "max" | "step" | "placeholder" | "maxLength"
> & {
  /** A date or a time is a `DateField` or a `TimeField`, which every browser shows alike. */
  type?: "text" | "email" | "tel" | "number" | "password";
};

/**
 * The fields of a form, in rows by their size, as wide as the form is (not the
 * window): one column below 448px, then six, where a quarter takes half the
 * row, then twelve from 900px, where a quarter holds a date and time (213px).
 * A child that is no field (a section, an alert, a line of text) takes the
 * whole row: the attribute selectors outweigh `&>*`, and the row start
 * outweighs the span's shorthand, whatever order the stylesheet writes them in.
 */
export function FormGrid(props: Omit<ComponentProps<typeof FieldSet>, "className">) {
  return (
    <div className="@container">
      <FieldSet
        className="grid grid-cols-1 @md:grid-cols-6 @md:[&>*]:col-span-6 @md:[&>[data-size=quarter]]:col-span-3 @md:[&>[data-size][data-starts-row]]:col-start-1 @[56.25rem]:grid-cols-12 @[56.25rem]:[&>*]:col-span-12 @[56.25rem]:[&>[data-size=half]]:col-span-6"
        {...props}
      />
    </div>
  );
}

function TextField(props: InputProps & FieldPlace & { label: string; hint?: string }) {
  const { label, hint, size, startsRow, ...input } = props;
  const field = useFieldContext<string>();
  const { problem, errorId, invalid } = useFieldProblem(field.name);
  const hintId = hint ? `${field.name}-hint` : undefined;
  return (
    <Field {...placeAttributes({ size, startsRow }, "quarter")} data-invalid={invalid}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Input
        {...input}
        id={field.name}
        name={field.name}
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

/** A date or a time, typed or picked: `DateInput` and `TimeInput` say how. */
function typedField(Box: typeof DateInput | typeof TimeInput) {
  return function TypedField(
    props: FieldPlace & { label: string; hint?: string; required?: boolean },
  ) {
    const field = useFieldContext<string>();
    const { problem, errorId, invalid } = useFieldProblem(field.name);
    const hintId = props.hint ? `${field.name}-hint` : undefined;
    return (
      <Field {...placeAttributes(props, "quarter")} data-invalid={invalid}>
        <FieldLabel htmlFor={field.name}>{props.label}</FieldLabel>
        <Box
          id={field.name}
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
  const hintId = hint ? `${field.name}-hint` : undefined;
  const box = useRef<HTMLTextAreaElement>(null);

  return (
    <Field {...placeAttributes(props, "full")} data-invalid={invalid}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
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
        id={field.name}
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

function SelectField(
  props: FieldPlace & {
    label: string;
    hint?: string;
    required?: boolean;
    children: ReactNode;
  },
) {
  const field = useFieldContext<string>();
  const { problem, errorId, invalid } = useFieldProblem(field.name);
  const hintId = props.hint ? `${field.name}-hint` : undefined;
  return (
    <Field {...placeAttributes(props, "quarter")} data-invalid={invalid}>
      <FieldLabel htmlFor={field.name}>{props.label}</FieldLabel>
      <NativeSelect
        id={field.name}
        name={field.name}
        required={props.required}
        value={field.state.value}
        onChange={(event) => field.handleChange(event.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={invalid}
        aria-describedby={joinIds(hintId, errorId)}
      >
        {props.children}
      </NativeSelect>
      <FieldHint id={hintId}>{props.hint}</FieldHint>
      <FieldProblemText id={errorId}>{problem}</FieldProblemText>
    </Field>
  );
}

export function SelectOptions(props: { options: { value: string; label: string }[] }) {
  return props.options.map((option) => (
    <NativeSelectOption key={option.value} value={option.value}>
      {option.label}
    </NativeSelectOption>
  ));
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
  const shown = (value: unknown) => props.options.find((option) => option.value === value);
  return (
    <Field {...placeAttributes(props, "quarter")} data-invalid={invalid}>
      <FieldLabel htmlFor={field.name}>{props.label}</FieldLabel>
      <Select
        value={field.state.value}
        onValueChange={(value) => field.handleChange(String(value))}
        disabled={submitting}
      >
        <SelectTrigger
          id={field.name}
          onBlur={field.handleBlur}
          aria-invalid={invalid}
          aria-describedby={errorId}
        >
          <SelectValue>{(value) => <MarkedLabel option={shown(value)} />}</SelectValue>
        </SelectTrigger>
        <SelectContent>
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

/** Whether the form is saving: a fieldset disables native inputs, not `Checkbox`. */
const useSubmitting = (form: AnyFormApi) => useStore(form.store, (state) => state.isSubmitting);

function CheckboxField(props: FieldPlace & { label: string }) {
  const field = useFieldContext<boolean>();
  const submitting = useSubmitting(field.form);
  const { problem, errorId, invalid } = useFieldProblem(field.name);
  return (
    <Field {...placeAttributes(props, "quarter")} data-invalid={invalid}>
      <Field orientation="horizontal" className="w-fit">
        <Checkbox
          id={field.name}
          checked={field.state.value}
          disabled={submitting}
          aria-invalid={invalid}
          aria-describedby={errorId}
          onCheckedChange={(checked) => field.handleChange(checked)}
        />
        <FieldLabel htmlFor={field.name}>{props.label}</FieldLabel>
      </Field>
      <FieldProblemText id={errorId}>{problem}</FieldProblemText>
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
function CheckboxGroupField(
  props: FieldPlace & { legend: string; options: Option[]; row?: boolean },
) {
  const field = useFieldContext<string[]>();
  const submitting = useSubmitting(field.form);
  const { problem, errorId, invalid } = useFieldProblem(field.name);
  const picked = field.state.value;

  function toggle(value: string, checked: boolean) {
    const others = picked.filter((one) => one !== value);
    field.handleChange(pickedIn(props.options, checked ? [...others, value] : others));
  }

  return (
    <FieldSet {...placeAttributes(props, "full")} id={field.name} data-invalid={invalid}>
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

/** What a `ComboboxField` finds for the text in its box. */
export interface ComboboxSearch<Item> {
  /** The answer to the text in the box; none until there is one. */
  items: Item[] | undefined;
  /** Whether that answer is still on its way. */
  waiting: boolean;
  /** Why the search failed, shown under the box. */
  problem: string | null;
  /** A muted line under the list, such as that more records match. */
  note?: string | null;
}

export interface ComboboxFieldProps<Item> extends FieldPlace {
  label: string;
  placeholder: string;
  /** The clear button's accessible name. */
  clearLabel: string;
  /** The line the list shows when nothing matches. */
  emptyText: string;
  /** Searches the server for what is typed, as style-guide § Tables says. */
  useSearch: (query: string) => ComboboxSearch<Item>;
  itemLabel: (item: Item) => string;
  itemKey: (item: Item) => string;
}

/**
 * One record picked from a server search. The record picked stays in the box,
 * typing searches, and the list opens only on the answer to the text in the box.
 */
function ComboboxField<Item>(props: ComboboxFieldProps<Item>) {
  const field = useFieldContext<Item | null>();
  const value = field.state.value;
  const box = useComboboxText(value === null ? null : props.itemLabel(value), value !== null, () =>
    field.handleChange(null),
  );
  const [open, setOpen] = useState(false);
  const search = props.useSearch(box.query);
  const { problem, errorId, searchErrorId, marked } = useComboboxProblem(field.name, search);
  // The list takes the box's whole width, not the bare input's.
  const anchor = useComboboxAnchor();

  return (
    <Field {...placeAttributes(props, "full")} data-invalid={marked}>
      <FieldLabel htmlFor={field.name}>{props.label}</FieldLabel>
      <Combobox
        items={search.items ?? []}
        filter={null}
        value={value}
        onValueChange={(item) => field.handleChange(item)}
        inputValue={box.text}
        onInputValueChange={box.change}
        open={open && search.items !== undefined}
        onOpenChange={setOpen}
        itemToStringLabel={props.itemLabel}
        isItemEqualToValue={(item, other) => props.itemKey(item) === props.itemKey(other)}
      >
        <div ref={anchor}>
          <ComboboxInput
            id={field.name}
            className="w-full"
            placeholder={props.placeholder}
            showTrigger={false}
            showClear={value !== null}
            clearLabel={props.clearLabel}
            onBlur={field.handleBlur}
            aria-invalid={marked}
            aria-describedby={joinIds(errorId, searchErrorId)}
          >
            <SearchMark waiting={search.waiting} />
          </ComboboxInput>
        </div>
        <ComboboxContent anchor={anchor} className="flex flex-col">
          <ComboboxResults {...props} note={search.note} />
        </ComboboxContent>
      </Combobox>
      <FieldProblemText id={errorId}>{problem}</FieldProblemText>
      {search.problem && <FieldError id={searchErrorId}>{search.problem}</FieldError>}
    </Field>
  );
}

/** The field's own problem and a failed search, which marks the field like one. */
function useComboboxProblem(name: string, search: ComboboxSearch<unknown>) {
  const { problem, errorId, invalid } = useFieldProblem(name);
  const searchErrorId = search.problem ? `${name}-search-error` : undefined;
  return { problem, errorId, searchErrorId, marked: invalid ?? (searchErrorId ? true : undefined) };
}

/** A spinner in the box while the answer is on its way. */
function SearchMark(props: { waiting: boolean }) {
  return (
    <InputGroupAddon>
      {props.waiting ? <Spinner aria-label="Buscando" /> : <SearchIcon aria-hidden="true" />}
    </InputGroupAddon>
  );
}

function ComboboxResults<Item>(props: ComboboxFieldProps<Item> & { note?: string | null }) {
  return (
    <>
      <ComboboxEmpty>{props.emptyText}</ComboboxEmpty>
      <ComboboxList className="min-h-0">
        {(item: Item) => (
          <ComboboxItem key={props.itemKey(item)} value={item}>
            {props.itemLabel(item)}
          </ComboboxItem>
        )}
      </ComboboxList>
      {props.note && (
        <p className="text-muted-foreground shrink-0 border-t px-3 py-2 text-sm">{props.note}</p>
      )}
    </>
  );
}

/** An option of a `MultiComboboxField`: its name, and a line that tells it apart. */
interface DetailedOption {
  value: string;
  label: string;
  detail: string;
}

/**
 * Several records picked from a list the page already holds: each pick shows
 * as a chip in the box, and typing narrows the list by name.
 */
function MultiComboboxField(
  props: FieldPlace & {
    label: string;
    options: DetailedOption[];
    placeholder?: string;
    /** The line the list shows when there is nothing to pick. */
    emptyText: string;
    /** The line the list shows when the search finds nothing. */
    noMatchText: (query: string) => string;
    /** A chip's remove button's accessible name. */
    removeLabel: (label: string) => string;
  },
) {
  const field = useFieldContext<string[]>();
  const submitting = useSubmitting(field.form);
  const { problem, errorId, invalid } = useFieldProblem(field.name);
  const [query, setQuery] = useState("");
  // The list takes the box's whole width, not the bare input's.
  const anchor = useComboboxAnchor();
  const picked = props.options.filter((option) => field.state.value.includes(option.value));

  return (
    <Field {...placeAttributes(props, "full")} data-invalid={invalid}>
      <FieldLabel htmlFor={field.name}>{props.label}</FieldLabel>
      <Combobox
        multiple
        items={props.options}
        value={picked}
        onValueChange={(options: DetailedOption[], details) => {
          // Base UI drops every pick on an Escape with the list closed: a
          // second Escape to close it would lose them. A chip removes its own.
          if (details.reason === "escape-key") {
            return;
          }
          field.handleChange(
            pickedIn(
              props.options,
              options.map((option) => option.value),
            ),
          );
        }}
        inputValue={query}
        onInputValueChange={setQuery}
        itemToStringLabel={(option: DetailedOption) => option.label}
        isItemEqualToValue={(option, other) => option.value === other.value}
        disabled={submitting}
      >
        <ComboboxChips ref={anchor}>
          <ComboboxValue>
            {(options: DetailedOption[]) =>
              options.map((option) => (
                <ComboboxChip key={option.value} removeLabel={props.removeLabel(option.label)}>
                  {option.label}
                </ComboboxChip>
              ))
            }
          </ComboboxValue>
          <ComboboxChipsInput
            id={field.name}
            placeholder={props.placeholder}
            onBlur={field.handleBlur}
            aria-invalid={invalid}
            aria-describedby={errorId}
          />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>
            {props.options.length === 0 ? props.emptyText : props.noMatchText(query.trim())}
          </ComboboxEmpty>
          <ComboboxList>
            {(option: DetailedOption) => (
              <ComboboxItem key={option.value} value={option}>
                <span className="flex flex-col">
                  {option.label}
                  <span className="text-muted-foreground text-xs">{option.detail}</span>
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <FieldProblemText id={errorId}>{problem}</FieldProblemText>
    </Field>
  );
}

/** The box's text and what it searches for, as `comboboxTextChange` moves them. */
function useComboboxText(pickedLabel: string | null, picked: boolean, dropPick: () => void) {
  const [text, setText] = useState(pickedLabel ?? "");
  const [query, setQuery] = useState("");
  function change(next: string, { reason }: { reason: string }) {
    const moved = comboboxTextChange(next, reason, picked);
    if (!moved) {
      return;
    }
    setText(moved.text);
    setQuery(moved.query);
    if (moved.dropPick) {
      dropPick();
    }
  }
  return { text, query, change };
}

export const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
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
