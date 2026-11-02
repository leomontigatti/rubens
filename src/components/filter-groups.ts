import type { LucideIcon } from "lucide-react";

// What `FilterBar` shows: which groups are applied, which can be added, and how
// a group's options are listed.

export interface FilterOption {
  value: string;
  label: string;
  /** The heading it sits under in its group's menu. */
  section?: string;
}

export interface FilterGroup {
  id: string;
  label: string;
  icon?: LucideIcon;
  options: FilterOption[];
  value: string | null;
  /** Always holds a value, so it has no way to be removed. */
  required?: boolean;
}

export type AppliedGroup = FilterGroup & { selected: FilterOption };

const selectedOption = (group: FilterGroup) =>
  group.options.find((option) => option.value === group.value);

export function appliedGroups(groups: FilterGroup[]): AppliedGroup[] {
  return groups.flatMap((group) => {
    const selected = selectedOption(group);
    return selected ? [{ ...group, selected }] : [];
  });
}

export function addableGroups(groups: FilterGroup[]): FilterGroup[] {
  return groups.filter((group) => !selectedOption(group) && group.options.length > 0);
}

export const folded = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLocaleLowerCase("es");

export function matchingOptions(options: FilterOption[], query: string): FilterOption[] {
  const needle = folded(query.trim());
  return options.filter((option) => folded(option.label).includes(needle));
}

export function optionSections(options: FilterOption[]) {
  const sections = new Map<string | undefined, FilterOption[]>();
  for (const option of options) {
    sections.set(option.section, [...(sections.get(option.section) ?? []), option]);
  }
  return [...sections].map(([name, listed]) => ({ name, options: listed }));
}
