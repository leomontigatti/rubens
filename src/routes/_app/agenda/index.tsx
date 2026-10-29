import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import * as z from "zod";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { mondayOf } from "#/lib/appointments.ts";
import { visibleWeekHours } from "#/lib/calendar-layout.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { formatLocalDate, shiftDate, today, weekdayLabels, weekdayOf } from "#/lib/schedules.ts";
import { getCalendarWeekView } from "#/server/appointments.functions.ts";
import { getAvailabilityPractitioners } from "#/server/availability.functions.ts";
import type { CalendarAppointment, CalendarWeek } from "#/server/calendar-week.ts";

import { AppointmentDialog } from "#/routes/_app/agenda/-appointment.tsx";
import type { PickedAppointment } from "#/routes/_app/agenda/-appointment.tsx";
import { BookingDialog } from "#/routes/_app/agenda/-booking.tsx";
import type { BookingSlot } from "#/routes/_app/agenda/-booking.tsx";
import { DayColumn, TimeAxis } from "#/routes/_app/agenda/-calendar.tsx";
import type { PickedCell } from "#/routes/_app/agenda/-calendar.tsx";
import { CalendarFilters } from "#/routes/_app/agenda/-filters.tsx";
import type { CalendarSearch } from "#/routes/_app/agenda/-filters.tsx";

// The calendar (docs/domain/appointments.md § Calendar): one room's week,
// narrowed to a practitioner or a medical service. What is viewed lives in
// the URL; a value that does not parse falls back to its default, the first
// active room and this week.
const searchSchema = z.object({
  consultorio: z.uuid().optional().catch(undefined),
  profesional: z.uuid().optional().catch(undefined),
  prestacion: z.uuid().optional().catch(undefined),
  fecha: z.iso.date().optional().catch(undefined),
  cancelados: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute("/_app/agenda/")({
  head: () => ({ meta: [{ title: "Agenda · Rubens" }] }),
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const date = deps.fecha ?? today(defaultTimeZone);
    const [calendar, practitioners] = await Promise.all([
      getCalendarWeekView({
        data: {
          roomId: deps.consultorio,
          date,
          practitionerId: deps.profesional,
          medicalServiceId: deps.prestacion,
          includeCancelledAndNoShow: deps.cancelados === true,
        },
      }),
      getAvailabilityPractitioners(),
    ]);
    if (!calendar.ok) {
      return calendar;
    }
    if (!practitioners.ok) {
      return practitioners;
    }
    return {
      ...calendar,
      practitioners: practitioners.practitioners,
      search: { ...deps, fecha: mondayOf(date) } satisfies CalendarSearch,
    };
  },
  component: Agenda,
});

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo recepción, un administrador o un profesional pueden ver la agenda.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá el consultorio y la fecha.",
  notFound: "No encontramos ese consultorio o esa prestación.",
};

/** What the booking dialog opens on: a free cell or none, and whether for an overbooking. */
interface BookingStart {
  slot: BookingSlot | null;
  overbooking: boolean;
}

function Agenda() {
  const result = Route.useLoaderData();
  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  if (!result.week) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <p className="text-muted-foreground">Todavía no hay consultorios.</p>
      </div>
    );
  }
  return (
    <Calendar
      week={result.week}
      roomChoices={result.roomChoices}
      practitioners={result.practitioners}
      search={result.search}
    />
  );
}

function Calendar(props: {
  week: CalendarWeek;
  roomChoices: Parameters<typeof CalendarFilters>[0]["roomChoices"];
  practitioners: { id: string; displayName: string }[];
  search: CalendarSearch & { fecha: string };
}) {
  const { week } = props;
  const [start, setStart] = useState<BookingStart>({ slot: null, overbooking: false });
  const [booking, setBooking] = useState(false);
  const [picked, setPicked] = useState<PickedAppointment | null>(null);
  const office = { rooms: week.office.rooms, timeZone: week.office.timeZone };

  function openBooking(slot: BookingSlot | null, overbooking: boolean) {
    setPicked(null);
    setStart({ slot, overbooking });
    setBooking(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => openBooking(null, true)}>
            Sobreturno
          </Button>
          <Button onClick={() => openBooking(null, false)}>Nuevo turno</Button>
        </div>
      </div>
      <CalendarFilters week={week} roomChoices={props.roomChoices} search={props.search} />
      <WeekNavigation search={props.search} />
      <WeekGrid
        week={week}
        onPick={(cell) => openBooking(slotOf(week, cell), false)}
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
      <BookingDialog
        open={booking}
        onOpenChange={setBooking}
        slot={start.slot}
        practitioners={props.practitioners}
        defaultDate={props.search.fecha}
        overbooking={start.overbooking ? office : null}
      />
      <AppointmentDialog
        picked={picked}
        onClose={() => setPicked(null)}
        office={office}
        onOverbook={(slot) => openBooking(slot, true)}
      />
    </div>
  );
}

/** A clicked cell as the booking form starts from it: the room, and the filtered medical service. */
function slotOf(week: CalendarWeek, cell: PickedCell): BookingSlot {
  const free = new Set(cell.practitionerIds);
  return {
    start: cell.start,
    roomName: week.room.name,
    timeZone: week.office.timeZone,
    practitioners: week.practitioners.filter((one) => free.has(one.id)),
    medicalService:
      week.medicalServices.find((one) => one.id === week.filter.medicalServiceId) ?? null,
  };
}

/** The week before and after, and a date to jump to. */
function WeekNavigation(props: { search: CalendarSearch & { fecha: string } }) {
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
      <Input
        aria-label="Ir a la fecha"
        type="date"
        className="w-auto"
        defaultValue={search.fecha}
        key={search.fecha}
        onChange={(event) =>
          event.target.value && void navigate({ to: "/agenda", search: linkTo(event.target.value) })
        }
      />
    </div>
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
  return (
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
  );
}
