import { ChevronLeftIcon, ChevronRightIcon, ListFilterPlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import {
  addableGroups,
  appliedGroups,
  matchingOptions,
  optionSections,
} from "#/components/filter-groups.ts";
import type { AppliedGroup, FilterGroup } from "#/components/filter-groups.ts";
import { Button } from "#/components/ui/button.tsx";
import { ButtonGroup, ButtonGroupText } from "#/components/ui/button-group.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";

/** Every applied filter as a button group, then the button that adds another. */
export function FilterBar(props: {
  groups: FilterGroup[];
  onPick: (groupId: string, value: string) => void;
  onRemove: (groupId: string) => void;
}) {
  const applied = appliedGroups(props.groups);
  const addRef = useRef<HTMLButtonElement>(null);
  const appliedCount = useRef(applied.length);

  // A removed filter takes its focused trash button with it.
  useEffect(() => {
    if (applied.length < appliedCount.current && document.activeElement === document.body) {
      addRef.current?.focus();
    }
    appliedCount.current = applied.length;
  }, [applied.length]);

  return (
    <>
      {applied.map((group) => (
        <AppliedFilter
          key={group.id}
          group={group}
          onPick={(value) => props.onPick(group.id, value)}
          onRemove={() => props.onRemove(group.id)}
        />
      ))}
      <AddFilter ref={addRef} groups={addableGroups(props.groups)} onPick={props.onPick} />
    </>
  );
}

function AppliedFilter(props: {
  group: AppliedGroup;
  onPick: (value: string) => void;
  onRemove: () => void;
}) {
  const { group } = props;
  const Icon = group.icon;
  return (
    <ButtonGroup aria-label={`${group.label}: ${group.selected.label}`}>
      <ButtonGroupText>
        {Icon && <Icon />}
        {group.label}
      </ButtonGroupText>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" />}>
          {group.selected.label}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-auto min-w-48">
          <DropdownMenuRadioGroup
            value={group.value}
            onValueChange={(value: string) => props.onPick(value)}
          >
            {optionSections(group.options).map((section) => (
              <DropdownMenuGroup key={section.name ?? ""}>
                {section.name && <DropdownMenuLabel>{section.name}</DropdownMenuLabel>}
                {section.options.map((option) => (
                  <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuGroup>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {!group.required && (
        <Button
          variant="outline"
          size="icon"
          aria-label={`Quitar filtro ${group.label}`}
          onClick={props.onRemove}
        >
          <Trash2Icon className="text-destructive" />
        </Button>
      )}
    </ButtonGroup>
  );
}

/** The picker that applies one more filter: a group, then one of its values. */
function AddFilter({
  ref,
  groups,
  onPick,
}: {
  ref: RefObject<HTMLButtonElement | null>;
  groups: FilterGroup[];
  onPick: (groupId: string, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState<string | null>(null);
  const group = groups.find((one) => one.id === groupId);

  if (groups.length === 0) {
    return null;
  }

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      setGroupId(null);
    }
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger ref={ref} render={<Button variant="outline" />}>
        <ListFilterPlusIcon data-icon="inline-start" />
        Agregar filtro
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        {group ? (
          <div className="flex flex-col gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => setGroupId(null)}
            >
              <ChevronLeftIcon data-icon="inline-start" />
              {group.label}
            </Button>
            <FilterOptionList
              group={group}
              onPick={(value) => {
                onPick(group.id, value);
                changeOpen(false);
              }}
            />
          </div>
        ) : (
          <div className="flex flex-col">
            <p className="text-muted-foreground px-2 py-1.5 text-xs">Filtrar por</p>
            {groups.map((one) => (
              <Button
                key={one.id}
                variant="ghost"
                size="sm"
                className="justify-between"
                onClick={() => setGroupId(one.id)}
              >
                {one.label}
                <ChevronRightIcon data-icon="inline-end" />
              </Button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Past this many values, a group's list gets a search box. */
const searchableOptionCount = 7;

function FilterOptionList(props: { group: FilterGroup; onPick: (value: string) => void }) {
  const { group } = props;
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const hasSearch = group.options.length > searchableOptionCount;
  const options = matchingOptions(group.options, query);
  const searchLabel = `Buscar ${group.label.toLocaleLowerCase("es")}`;

  // The button that led here is gone, so focus would fall to the page: with no
  // search box to take it, the first value does.
  useEffect(() => {
    if (!hasSearch) {
      listRef.current?.querySelector("button")?.focus();
    }
  }, [hasSearch]);

  return (
    <>
      {hasSearch && (
        <Input
          autoFocus
          aria-label={searchLabel}
          placeholder={searchLabel}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      <div ref={listRef} className="flex max-h-72 flex-col overflow-y-auto">
        {options.map((option) => (
          <Button
            key={option.value}
            variant="ghost"
            size="sm"
            className="justify-start"
            onClick={() => props.onPick(option.value)}
          >
            {option.label}
          </Button>
        ))}
        {options.length === 0 && (
          <p className="text-muted-foreground px-2 py-1.5 text-sm">Sin resultados.</p>
        )}
      </div>
    </>
  );
}
