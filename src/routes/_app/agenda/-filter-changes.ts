import type { RoomChoice } from "#/server/calendar-week.ts";

// What each calendar filter does to the URL: a new room drops the other filters,
// its practitioners being others; a medical service implies its practitioner.

/** What the calendar's URL asks for, each value already parsed. */
export interface CalendarSearch {
  consultorio?: string;
  profesional?: string;
  prestacion?: string;
  fecha?: string;
  cancelados?: boolean;
}

interface FilterWeek {
  practitioners: { id: string; displayName: string }[];
  medicalServices: { id: string; name: string; durationMinutes: number; practitionerId: string }[];
  filter: { practitionerId: string | null };
}

export type CalendarFilterId = "consultorio" | "profesional" | "prestacion";

/** The active rooms under their office, and the viewed room, which may be deactivated since. */
export function roomOptions(
  viewed: { id: string; name: string },
  officeName: string,
  roomChoices: RoomChoice[],
) {
  const options = roomChoices.flatMap((choice) =>
    choice.rooms.map((room) => ({
      value: room.id,
      label: room.name,
      section: choice.officeName,
    })),
  );
  return options.some((option) => option.value === viewed.id)
    ? options
    : [{ value: viewed.id, label: viewed.name, section: officeName }, ...options];
}

/** The chosen practitioner's medical services, or everyone's named with their practitioner. */
export function serviceOptions(week: FilterWeek) {
  const { practitionerId } = week.filter;
  const names = new Map(week.practitioners.map((one) => [one.id, one.displayName]));
  return week.medicalServices
    .filter((one) => practitionerId === null || one.practitionerId === practitionerId)
    .map((one) => ({
      value: one.id,
      label: `${one.name} (${one.durationMinutes} min)${practitionerId === null ? ` · ${names.get(one.practitionerId)}` : ""}`,
    }));
}

/** The URL change a filter's new value makes; `null` removes the filter. */
export function filterChange(
  id: CalendarFilterId,
  value: string | null,
  week: FilterWeek,
): CalendarSearch {
  if (id === "consultorio") {
    return { consultorio: value ?? undefined, profesional: undefined, prestacion: undefined };
  }
  if (id === "profesional") {
    return { profesional: value ?? undefined, prestacion: undefined };
  }
  const service = week.medicalServices.find((one) => one.id === value);
  return service
    ? { prestacion: service.id, profesional: service.practitionerId }
    : { prestacion: undefined };
}
