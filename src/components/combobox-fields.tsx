import { SearchIcon } from "lucide-react";
import { useState } from "react";

import { comboboxTextChange } from "#/components/combobox-text.ts";
import { placeAttributes } from "#/components/field-size.ts";
import type { FieldPlace } from "#/components/field-size.ts";
import { FieldProblemText, useFieldId, useFieldProblem } from "#/components/field-problem.tsx";
import { joinIds, pickedIn, useFieldContext, useSubmitting } from "#/components/form-fields.tsx";
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
import { Field, FieldError, FieldLabel } from "#/components/ui/field.tsx";
import { InputGroupAddon } from "#/components/ui/input-group.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";

// The form kit's comboboxes, registered in `app-form.tsx`: one record picked
// from a server search, and several picked from a list the page holds.

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
export function ComboboxField<Item>(props: ComboboxFieldProps<Item>) {
  const field = useFieldContext<Item | null>();
  const value = field.state.value;
  const box = useComboboxText(value === null ? null : props.itemLabel(value), value !== null, () =>
    field.handleChange(null),
  );
  const [open, setOpen] = useState(false);
  const search = props.useSearch(box.query);
  const { problem, errorId, searchErrorId, marked } = useComboboxProblem(field.name, search);
  const id = useFieldId(field.name);
  // The list takes the box's whole width, not the bare input's.
  const anchor = useComboboxAnchor();

  return (
    <Field {...placeAttributes(props, "full")} data-invalid={marked}>
      <FieldLabel htmlFor={id}>{props.label}</FieldLabel>
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
            id={id}
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
  const id = useFieldId(name);
  const searchErrorId = search.problem ? `${id}-search-error` : undefined;
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
export function MultiComboboxField(
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
  const id = useFieldId(field.name);
  const [query, setQuery] = useState("");
  // The list takes the box's whole width, not the bare input's.
  const anchor = useComboboxAnchor();
  const picked = props.options.filter((option) => field.state.value.includes(option.value));

  return (
    <Field {...placeAttributes(props, "full")} data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{props.label}</FieldLabel>
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
            id={id}
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
