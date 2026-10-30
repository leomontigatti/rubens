import { Link, useNavigate } from "@tanstack/react-router";

import { Button } from "#/components/ui/button.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "#/components/ui/native-select.tsx";
import type { CalendarWeek, RoomChoice } from "#/server/calendar-week.ts";

// The calendar's filters, in their order: the room, required; then the
// practitioner and the medical service, each optional. A medical service
// implies its practitioner. Each change navigates.

/** What the calendar's URL asks for, each value already parsed. */
export interface CalendarSearch {
  consultorio?: string;
  profesional?: string;
  prestacion?: string;
  fecha?: string;
  cancelados?: boolean;
}

type Go = (changed: CalendarSearch) => void;

export function CalendarFilters(props: {
  week: CalendarWeek;
  roomChoices: RoomChoice[];
  search: CalendarSearch;
}) {
  const navigate = useNavigate();
  const { week, search } = props;
  const go: Go = (changed) => void navigate({ to: "/agenda", search: { ...search, ...changed } });
  return (
    <div className="flex flex-wrap items-end gap-4">
      <RoomFilter roomId={week.room.id} roomChoices={props.roomChoices} go={go} />
      <PractitionerFilter week={week} go={go} />
      <MedicalServiceFilter week={week} go={go} />
      <CancelledToggle search={search} />
    </div>
  );
}

/** A new room drops the other filters: its practitioners are others. */
function RoomFilter(props: { roomId: string; roomChoices: RoomChoice[]; go: Go }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="calendar-room">Consultorio</Label>
      <NativeSelect
        id="calendar-room"
        value={props.roomId}
        onChange={(event) =>
          props.go({
            consultorio: event.target.value,
            profesional: undefined,
            prestacion: undefined,
          })
        }
      >
        {props.roomChoices.map((choice) => (
          <NativeSelectOptGroup key={choice.officeId} label={choice.officeName}>
            {choice.rooms.map((room) => (
              <NativeSelectOption key={room.id} value={room.id}>
                {room.name}
              </NativeSelectOption>
            ))}
          </NativeSelectOptGroup>
        ))}
      </NativeSelect>
    </div>
  );
}

function PractitionerFilter(props: { week: CalendarWeek; go: Go }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="calendar-practitioner">Profesional</Label>
      <NativeSelect
        id="calendar-practitioner"
        value={props.week.filter.practitionerId ?? ""}
        onChange={(event) =>
          props.go({ profesional: event.target.value || undefined, prestacion: undefined })
        }
      >
        <NativeSelectOption value="">Todos</NativeSelectOption>
        {props.week.practitioners.map((one) => (
          <NativeSelectOption key={one.id} value={one.id}>
            {one.displayName}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

/** The chosen practitioner's medical services, or everyone's named with their practitioner. */
function serviceOptions(week: CalendarWeek) {
  const { practitionerId } = week.filter;
  const names = new Map(week.practitioners.map((one) => [one.id, one.displayName]));
  return week.medicalServices
    .filter((one) => practitionerId === null || one.practitionerId === practitionerId)
    .map((one) => ({
      ...one,
      label: `${one.name} (${one.durationMinutes} min)${practitionerId === null ? ` · ${names.get(one.practitionerId)}` : ""}`,
    }));
}

/** Choosing a medical service sets its practitioner; clearing it keeps the practitioner. */
function MedicalServiceFilter(props: { week: CalendarWeek; go: Go }) {
  const options = serviceOptions(props.week);
  function choose(id: string) {
    const service = options.find((one) => one.id === id);
    props.go(
      service
        ? { prestacion: service.id, profesional: service.practitionerId }
        : { prestacion: undefined },
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="calendar-medical-service">Prestación</Label>
      <NativeSelect
        id="calendar-medical-service"
        value={props.week.filter.medicalServiceId ?? ""}
        onChange={(event) => choose(event.target.value)}
      >
        <NativeSelectOption value="">Todas</NativeSelectOption>
        {options.map((one) => (
          <NativeSelectOption key={one.id} value={one.id}>
            {one.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
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
