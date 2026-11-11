import { createFormHook, createFormHookContexts, useStore } from "@tanstack/react-form";
import type { AnyFormApi } from "@tanstack/react-form";
import { SearchIcon } from "lucide-react";
import { createContext, useContext, useState } from "react";
import type { ComponentProps, ReactNode } from "react";

import { comboboxTextChange } from "#/components/combobox-text.ts";
import { placeAttributes, textFieldSize } from "#/components/field-size.ts";
import type { FieldPlace } from "#/components/field-size.ts";
import type { FieldProblem } from "#/components/form-problems.ts";

import { Checkbox } from "#/components/ui/checkbox.tsx";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
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
import { NativeSelect } from "#/components/ui/native-select.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";

// The form kit: `useAppForm` holds a form's values, and each field below reads
// and writes its own through `form.AppField`. Number inputs hold their text, as
// typed: the form's schema decides what it is worth when it submits. Each
// field takes a `size` in its form's `FormGrid`, by default the one its kind
// usually needs (`field-size.ts`).

const { fieldContext, formContext, useFieldContext } = createFormHookContexts();

/** What the last submit refused, which each field finds its own in. */
export const FormProblemsContext = createContext<FieldProblem[]>([]);

const joinIds = (...ids: (string | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;

/** A field's problem, and what its input needs to say so to a screen reader. */
export function useFieldProblem(name: string) {
  const problem = useContext(FormProblemsContext).find((one) => one.field === name)?.message;
  return problem
    ? { problem, errorId: `${name}-error`, invalid: true as const }
    : { problem, errorId: undefined, invalid: undefined };
}

/** The hint a field's input points at, when it has one. */
function FieldHint(props: { id?: string; children?: string }) {
  return props.id ? <FieldDescription id={props.id}>{props.children}</FieldDescription> : null;
}

/** Under the field. No live region: focus moves to the first one, which reads it out. */
export function FieldProblemText(props: { id?: string; children?: string }) {
  return props.id ? (
    <FieldError id={props.id} role={undefined}>
      {props.children}
    </FieldError>
  ) : null;
}

type InputProps = Pick<
  ComponentProps<typeof Input>,
  "type" | "required" | "autoComplete" | "min" | "max" | "step" | "placeholder" | "maxLength"
>;

/**
 * The fields of a form, in rows by their size. A child that is no field (a
 * section, an alert, a line of text) takes the whole row: the attribute
 * selectors outweigh `&>*`, and the row start outweighs the span's shorthand,
 * whatever order the stylesheet writes them in.
 */
export function FormGrid(props: Omit<ComponentProps<typeof FieldSet>, "className">) {
  return (
    <FieldSet
      className="grid grid-cols-1 md:grid-cols-6 md:[&>*]:col-span-6 md:[&>[data-size=medium]]:col-span-3 md:[&>[data-size=small]]:col-span-2 md:[&>[data-size][data-starts-row]]:col-start-1"
      {...props}
    />
  );
}

function TextField(props: InputProps & FieldPlace & { label: string; hint?: string }) {
  const { label, hint, size, startsRow, ...input } = props;
  const field = useFieldContext<string>();
  const { problem, errorId, invalid } = useFieldProblem(field.name);
  const hintId = hint ? `${field.name}-hint` : undefined;
  return (
    <Field
      {...placeAttributes({ size, startsRow }, textFieldSize(input.type))}
      data-invalid={invalid}
    >
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

/** A long text, such as a message body, whose box grows with what it holds. */
function TextareaField(
  props: FieldPlace & {
    label: string;
    hint?: string;
    required?: boolean;
    /** What sits under the hint, such as the text as it will be sent. */
    preview?: ReactNode;
  },
) {
  const { label, hint, required, preview } = props;
  const field = useFieldContext<string>();
  const { problem, errorId, invalid } = useFieldProblem(field.name);
  const hintId = hint ? `${field.name}-hint` : undefined;
  return (
    <Field {...placeAttributes(props, "large")} data-invalid={invalid}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Textarea
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

/** Small by default, for a few short options; a longer one names `medium`. */
function SelectField(
  props: FieldPlace & {
    label: string;
    hint?: string;
    required?: boolean;
    /** What sits beside the select, such as a colour's swatch. */
    beside?: ReactNode;
    children: ReactNode;
  },
) {
  const field = useFieldContext<string>();
  const { problem, errorId, invalid } = useFieldProblem(field.name);
  const hintId = props.hint ? `${field.name}-hint` : undefined;
  const select = (
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
  );
  return (
    <Field {...placeAttributes(props, "small")} data-invalid={invalid}>
      <FieldLabel htmlFor={field.name}>{props.label}</FieldLabel>
      {props.beside ? (
        <div className="flex items-center gap-3">
          {select}
          {props.beside}
        </div>
      ) : (
        select
      )}
      <FieldHint id={hintId}>{props.hint}</FieldHint>
      <FieldProblemText id={errorId}>{problem}</FieldProblemText>
    </Field>
  );
}

/** Whether the form is saving: a fieldset disables native inputs, not `Checkbox`. */
const useSubmitting = (form: AnyFormApi) => useStore(form.store, (state) => state.isSubmitting);

function CheckboxField(props: FieldPlace & { label: string }) {
  const field = useFieldContext<boolean>();
  const submitting = useSubmitting(field.form);
  return (
    <Field {...placeAttributes(props, "large")} orientation="horizontal" className="w-fit">
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
    <FieldSet {...placeAttributes(props, "large")} id={field.name} data-invalid={invalid}>
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
    <Field {...placeAttributes(props, "large")} data-invalid={marked}>
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
    TextareaField,
    SelectField,
    CheckboxField,
    CheckboxGroupField,
    ComboboxField,
  },
  formComponents: {},
});
