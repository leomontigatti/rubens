import { Link, useNavigate } from "@tanstack/react-router";
import { BuildingIcon, StethoscopeIcon, UserRoundIcon } from "lucide-react";

import { FilterBar } from "#/components/filter-bar.tsx";
import type { FilterGroup } from "#/components/filter-groups.ts";
import { Button } from "#/components/ui/button.tsx";
import type { CalendarWeek, RoomChoice } from "#/organization/calendar-week.ts";

import { filterChange, roomOptions, serviceOptions } from "#/routes/_app/agenda/-filter-changes.ts";
import type { CalendarFilterId, CalendarSearch } from "#/routes/_app/agenda/-filter-changes.ts";

// The calendar's filters, in their order: the room, required; then the
// practitioner and the medical service, each optional. Each change navigates.

function filterGroups(week: CalendarWeek, roomChoices: RoomChoice[]): FilterGroup[] {
  return [
    {
      id: "consultorio",
      label: "Consultorio",
      icon: BuildingIcon,
      required: true,
      value: week.room.id,
      options: roomOptions(week.room, week.office.name, roomChoices),
    },
    {
      id: "profesional",
      label: "Profesional",
      icon: UserRoundIcon,
      value: week.filter.practitionerId,
      options: week.practitioners.map((one) => ({ value: one.id, label: one.displayName })),
    },
    {
      id: "prestacion",
      label: "Prestación",
      icon: StethoscopeIcon,
      value: week.filter.medicalServiceId,
      options: serviceOptions(week),
    },
  ];
}

export function CalendarFilters(props: {
  week: CalendarWeek;
  roomChoices: RoomChoice[];
  search: CalendarSearch;
}) {
  const navigate = useNavigate();
  const { week, search } = props;
  const change = (id: string, value: string | null) =>
    void navigate({
      to: "/agenda",
      search: { ...search, ...filterChange(id as CalendarFilterId, value, week) },
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterBar
        groups={filterGroups(week, props.roomChoices)}
        onPick={change}
        onRemove={(id) => change(id, null)}
      />
      <CancelledToggle search={search} />
    </div>
  );
}

function CancelledToggle(props: { search: CalendarSearch }) {
  const shown = props.search.cancelados === true;
  return (
    <Button
      variant="ghost"
      nativeButton={false}
      render={
        <Link to="/agenda" search={{ ...props.search, cancelados: shown ? undefined : true }} />
      }
    >
      {shown ? "Ocultar cancelados y ausentes" : "Mostrar cancelados y ausentes"}
    </Button>
  );
}
