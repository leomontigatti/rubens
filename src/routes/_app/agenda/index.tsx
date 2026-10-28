import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import * as z from "zod";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { Button } from "#/components/ui/button.tsx";
import { agendaViewOf } from "#/lib/appointments.ts";
import { visibleHours } from "#/lib/calendar-layout.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { formatLocalDate, shiftDate, today, weekdayLabels, weekdayOf } from "#/lib/schedules.ts";
import { getOfficeDayView } from "#/server/appointments.functions.ts";
import type { DayColumn } from "#/server/appointments.ts";
import { getAvailabilityPractitioners } from "#/server/availability.functions.ts";
import { getOffices } from "#/server/offices.functions.ts";

import { AppointmentDialog } from "#/routes/_app/agenda/-appointment.tsx";
import type { PickedAppointment } from "#/routes/_app/agenda/-appointment.tsx";
import { BookingDialog } from "#/routes/_app/agenda/-booking.tsx";
import { HourGutter, PractitionerColumn, ViewFields } from "#/routes/_app/agenda/-calendar.tsx";
import type { BookingSlot, OverbookingOffice } from "#/routes/_app/agenda/-booking.tsx";

// Reception's main screen: one office's day, a column per practitioner. What
// is being viewed lives in the URL; a value that does not parse falls back to
// its default, the first office and today.
const searchSchema = z.object({
  sede: z.uuid().optional().catch(undefined),
  fecha: z.iso.date().optional().catch(undefined),
  cancelados: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute("/_app/agenda/")({
  head: () => ({ meta: [{ title: "Agenda · Rubens" }] }),
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [offices, practitioners] = await Promise.all([
      getOffices({ data: { includeInactive: false } }),
      getAvailabilityPractitioners(),
    ]);
    if (!offices.ok) {
      return offices;
    }
    if (!practitioners.ok) {
      return practitioners;
    }
    const view = agendaViewOf(deps, offices.offices, today(defaultTimeZone));
    return {
      ok: true as const,
      offices: offices.offices,
      practitioners: practitioners.practitioners,
      ...view,
      showCancelled: deps.cancelados === true,
      day: await dayOf({ ...view, includeCancelled: deps.cancelados === true }),
    };
  },
  component: Agenda,
});

function dayOf(view: { officeId: string | null; date: string; includeCancelled: boolean }) {
  const { officeId, date, includeCancelled } = view;
  return officeId === null
    ? null
    : getOfficeDayView({ data: { officeId, date, includeCancelled } });
}

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo recepción, un administrador o un profesional pueden ver la agenda.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá la sede y la fecha.",
  notFound: "No encontramos esa sede.",
};

/** What the booking dialog opens on: a free time or none, and whether for a sobreturno. */
interface BookingStart {
  slot: BookingSlot | null;
  overbooking: boolean;
}

function Agenda() {
  const result = Route.useLoaderData();
  const [start, setStart] = useState<BookingStart>({ slot: null, overbooking: false });
  const [booking, setBooking] = useState(false);
  const [picked, setPicked] = useState<PickedAppointment | null>(null);

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  const office = officeOf(result.day);

  function openBooking(slot: BookingSlot | null, overbooking: boolean) {
    setPicked(null);
    setStart({ slot, overbooking });
    setBooking(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <AgendaHeader
        canOverbook={office !== null}
        onBook={(overbooking) => openBooking(null, overbooking)}
      />
      {result.officeId === null ? (
        <p className="text-muted-foreground">Todavía no hay sedes.</p>
      ) : (
        <DayPicker
          offices={result.offices}
          officeId={result.officeId}
          date={result.date}
          showCancelled={result.showCancelled}
        />
      )}
      <DayResult
        day={result.day}
        date={result.date}
        onPick={(slot) => openBooking(slot, false)}
        onOpen={setPicked}
      />
      <BookingDialog
        open={booking}
        onOpenChange={setBooking}
        slot={start.slot}
        practitioners={result.practitioners}
        defaultDate={result.date}
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

/** The title, and the two ways to book: a free time, or a sobreturno once an office is viewed. */
function AgendaHeader(props: { canOverbook: boolean; onBook: (overbooking: boolean) => void }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <h1 className="text-2xl font-semibold">Agenda</h1>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" nativeButton={false} render={<Link to="/agenda/semana" />}>
          Semana
        </Button>
        <Button variant="ghost" nativeButton={false} render={<Link to="/agenda/consultorios" />}>
          Consultorios
        </Button>
        {props.canOverbook && (
          <Button variant="outline" onClick={() => props.onBook(true)}>
            Sobreturno
          </Button>
        )}
        <Button onClick={() => props.onBook(false)}>Nuevo turno</Button>
      </div>
    </div>
  );
}

/** The office viewed, where a sobreturno can go; none until its day has loaded. */
function officeOf(day: Awaited<ReturnType<typeof dayOf>>): OverbookingOffice | null {
  return day?.ok ? { rooms: day.rooms, timeZone: day.office.timeZone } : null;
}

function DayResult(props: {
  day: Awaited<ReturnType<typeof dayOf>>;
  date: string;
  onPick: (slot: BookingSlot) => void;
  onOpen: (picked: PickedAppointment) => void;
}) {
  if (!props.day) {
    return null;
  }
  if (!props.day.ok) {
    return <RefusalMessage message={refusalMessages[props.day.reason]} />;
  }
  return (
    <DayView
      date={props.date}
      timeZone={props.day.office.timeZone}
      columns={props.day.columns}
      onPick={props.onPick}
      onOpen={props.onOpen}
    />
  );
}

function DayPicker(props: {
  offices: { id: string; name: string }[];
  officeId: string;
  date: string;
  showCancelled: boolean;
}) {
  const navigate = useNavigate();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const search = searchSchema.parse({
      sede: form.get("officeId") || undefined,
      fecha: form.get("date") || undefined,
      cancelados: props.showCancelled || undefined,
    });
    void navigate({ to: "/agenda", search });
  }

  const linkTo = (date: string, showCancelled = props.showCancelled) => ({
    sede: props.officeId,
    fecha: date,
    cancelados: showCancelled || undefined,
  });

  return (
    <form
      // Remounting on a new day resets the fields to what is being viewed.
      key={`${props.officeId} ${props.date}`}
      onSubmit={submit}
      className="flex flex-wrap items-end gap-4"
    >
      <ViewFields
        name="officeId"
        label="Sede"
        options={props.offices}
        value={props.officeId}
        dateLabel="Fecha"
        date={props.date}
      />
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          nativeButton={false}
          render={<Link to="/agenda" search={linkTo(shiftDate(props.date, -1))} />}
        >
          Día anterior
        </Button>
        <span className="text-sm font-medium">
          {weekdayLabels[weekdayOf(props.date)]} {formatLocalDate(props.date)}
        </span>
        <Button
          variant="ghost"
          nativeButton={false}
          render={<Link to="/agenda" search={linkTo(shiftDate(props.date, 1))} />}
        >
          Día siguiente
        </Button>
      </div>
      <Button
        variant="ghost"
        nativeButton={false}
        render={<Link to="/agenda" search={linkTo(props.date, !props.showCancelled)} />}
      >
        {props.showCancelled ? "Ocultar cancelados" : "Mostrar cancelados"}
      </Button>
    </form>
  );
}

function DayView(props: {
  date: string;
  timeZone: string;
  columns: DayColumn[];
  onPick: (slot: BookingSlot) => void;
  onOpen: (picked: PickedAppointment) => void;
}) {
  if (props.columns.length === 0) {
    return <p className="text-muted-foreground">Nadie atiende en esta sede ese día.</p>;
  }
  const view = visibleHours(
    props.columns.flatMap((column) => [...column.schedules, ...column.appointments]),
    props.date,
    props.timeZone,
  );

  return (
    <div className="flex overflow-x-auto rounded-xl border">
      <HourGutter view={view} timeZone={props.timeZone} />
      {props.columns.map((column) => (
        <PractitionerColumn
          key={column.practitioner.id}
          title={column.practitioner.displayName}
          practitioner={column.practitioner}
          column={column}
          view={view}
          timeZone={props.timeZone}
          onPick={props.onPick}
          onOpen={(appointment) => props.onOpen({ appointment, practitioner: column.practitioner })}
        />
      ))}
    </div>
  );
}
