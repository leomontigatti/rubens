import { CalendarDaysIcon, PlusIcon } from "lucide-react";
import { ClientOnly, Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import * as z from "zod";

import { EmptyState, EmptyStateLink } from "#/components/empty-state.tsx";
import { RefusalMessage } from "#/components/admin-form.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { mondayOf } from "#/lib/appointments.ts";
import { visibleWeekHours } from "#/lib/calendar-layout.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { formatLocalDate, shiftDate, today, weekdayLabels, weekdayOf } from "#/lib/schedules.ts";
import { getCalendarWeekView } from "#/server/appointments.functions.ts";
import type { CalendarAppointment, CalendarWeek } from "#/organization/calendar-week.ts";

import { AppointmentDialog } from "#/routes/_app/agenda/-appointment.tsx";
import type { PickedAppointment } from "#/routes/_app/agenda/-appointment.tsx";
import { DayColumn, TimeAxis, WeekGridFrame } from "#/routes/_app/agenda/-calendar.tsx";
import type { PickedCell } from "#/routes/_app/agenda/-calendar.tsx";
import type { CalendarSearch } from "#/routes/_app/agenda/-filter-changes.ts";
import { CalendarFilters } from "#/routes/_app/agenda/-filters.tsx";

// The calendar (docs/domain/appointments.md § Calendar): one room's week,
// narrowed to a practitioner or a medical service. What is viewed lives in
// the URL; a value that does not parse falls back to its default, this week and
// the room the calendar opens on. The opening's room and practitioner join the
// search the filters extend, so removing the practitioner then means everyone
// rather than opening again.
const searchSchema = z.object({
  consultorio: z.uuid().optional().catch(undefined),
  profesional: z.uuid().optional().catch(undefined),
  prestacion: z.uuid().optional().catch(undefined),
  fecha: z.iso.date().optional().catch(undefined),
  cancelados: z.boolean().optional().catch(undefined),
});

type DatedSearch = CalendarSearch & { fecha: string };

/** What the filters extend: the URL, with the room and practitioner an opening picked. */
function viewedSearch(search: DatedSearch, week: CalendarWeek | null): DatedSearch {
  if (search.consultorio !== undefined || week === null) {
    return search;
  }
  return {
    ...search,
    consultorio: week.room.id,
    profesional: week.filter.practitionerId ?? undefined,
  };
}

export const Route = createFileRoute("/_app/agenda/")({
  head: () => ({ meta: [{ title: "Agenda · Rubens" }] }),
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const date = deps.fecha ?? today(defaultTimeZone);
    const calendar = await getCalendarWeekView({
      data: {
        roomId: deps.consultorio,
        date,
        practitionerId: deps.profesional,
        medicalServiceId: deps.prestacion,
        includeCancelledAndNoShow: deps.cancelados === true,
      },
    });
    if (!calendar.ok) {
      return calendar;
    }
    return {
      ...calendar,
      search: viewedSearch({ ...deps, fecha: mondayOf(date) }, calendar.week),
    };
  },
  component: Agenda,
});

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo recepción, un administrador o un profesional pueden ver la agenda.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá el consultorio y la fecha.",
  notFound: "No encontramos ese consultorio.",
};

function Agenda() {
  const result = Route.useLoaderData();
  const isAdmin = Route.useRouteContext().viewer.roles.includes("admin");
  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  if (!result.week) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Agenda"
          description="Los turnos de la semana, consultorio por consultorio."
        />
        <EmptyState
          icon={CalendarDaysIcon}
          title="Sin consultorios activos"
          description={
            isAdmin
              ? "Todavía no hay consultorios activos. Empezá agregando uno en Sedes."
              : "Todavía no hay consultorios activos."
          }
        >
          {isAdmin && <EmptyStateLink link={<Link to="/sedes" />}>Ir a Sedes</EmptyStateLink>}
        </EmptyState>
      </div>
    );
  }
  return <Calendar week={result.week} roomChoices={result.roomChoices} search={result.search} />;
}

function Calendar(props: {
  week: CalendarWeek;
  roomChoices: Parameters<typeof CalendarFilters>[0]["roomChoices"];
  search: DatedSearch;
}) {
  const { week, search } = props;
  const navigate = useNavigate();
  const [picked, setPicked] = useState<PickedAppointment | null>(null);
  // A booking's page opens on the room and week viewed.
  const viewed = { consultorio: week.room.id, fecha: search.fecha };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Agenda"
        description="Los turnos de la semana, consultorio por consultorio."
        actions={
          <>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to="/agenda/sobreturnos/nuevo" search={viewed} />}
            >
              <PlusIcon data-icon="inline-start" aria-hidden />
              Sobreturno
            </Button>
            <Button
              nativeButton={false}
              render={<Link to="/agenda/turnos/nuevo" search={viewed} />}
            >
              <PlusIcon data-icon="inline-start" aria-hidden />
              Nuevo turno
            </Button>
          </>
        }
      />
      <CalendarFilters week={week} roomChoices={props.roomChoices} search={search} />
      <WeekNavigation search={search} />
      <WeekGrid
        week={week}
        onPick={(cell) =>
          void navigate({
            to: "/agenda/turnos/nuevo",
            search: {
              ...viewed,
              // The medical service filtered starts the form, with its duration.
              prestacion: week.filter.medicalServiceId ?? undefined,
              inicio: cell.start.toISOString(),
              profesionales: cell.practitionerIds,
            },
          })
        }
        onOpen={(appointment) =>
          setPicked({
            appointment,
            practitioner: {
              id: appointment.practitionerId,
              displayName: appointment.practitionerName,
            },
          })
        }
      />
      <AppointmentDialog
        picked={picked}
        onClose={() => setPicked(null)}
        viewed={{ timeZone: week.office.timeZone, roomId: week.room.id, date: search.fecha }}
      />
    </div>
  );
}

/** The week before and after, and a date to jump to. */
function WeekNavigation(props: { search: DatedSearch }) {
  const navigate = useNavigate();
  const { search } = props;
  const linkTo = (fecha: string) => ({ ...search, fecha });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="ghost"
        nativeButton={false}
        render={<Link to="/agenda" search={linkTo(shiftDate(search.fecha, -7))} />}
      >
        Semana anterior
      </Button>
      <span className="text-sm font-medium">
        Semana del {formatLocalDate(search.fecha)} al {formatLocalDate(shiftDate(search.fecha, 6))}
      </span>
      <Button
        variant="ghost"
        nativeButton={false}
        render={<Link to="/agenda" search={linkTo(shiftDate(search.fecha, 7))} />}
      >
        Semana siguiente
      </Button>
      <DateJump
        // A new week starts it over from that week.
        key={search.fecha}
        date={search.fecha}
        onJump={(fecha) => void navigate({ to: "/agenda", search: linkTo(fecha) })}
      />
    </div>
  );
}

/** A date to jump to, which holds what is typed until it is a whole date. */
function DateJump(props: { date: string; onJump: (date: string) => void }) {
  const [typed, setTyped] = useState(props.date);
  return (
    <Input
      aria-label="Ir a la fecha"
      type="date"
      className="w-auto"
      value={typed}
      onChange={(event) => {
        setTyped(event.target.value);
        if (event.target.value) {
          props.onJump(event.target.value);
        }
      }}
    />
  );
}

function WeekGrid(props: {
  week: CalendarWeek;
  onPick: (cell: PickedCell) => void;
  onOpen: (appointment: CalendarAppointment) => void;
}) {
  const { week } = props;
  const { timeZone } = week.office;
  const views = visibleWeekHours(
    week.days.map((day) => ({ date: day.date, ranges: [...day.schedules, ...day.cards] })),
    timeZone,
  );
  // The grid renders only in the browser: drawn on the server, its cells and
  // cards cost the page more CPU than a Worker on the free plan gets (#139).
  // The server sends the week's data and an empty frame of the grid's height.
  return (
    <ClientOnly fallback={<WeekGridFrame view={views[0]!} />}>
      <div className="flex overflow-x-auto rounded-xl border">
        <TimeAxis view={views[0]!} timeZone={timeZone} />
        {week.days.map((day, index) => (
          <DayColumn
            key={day.date}
            title={`${weekdayLabels[weekdayOf(day.date)]} ${formatLocalDate(day.date).slice(0, 5)}`}
            day={day}
            view={views[index]!}
            timeZone={timeZone}
            onPick={props.onPick}
            onOpen={props.onOpen}
          />
        ))}
      </div>
    </ClientOnly>
  );
}
