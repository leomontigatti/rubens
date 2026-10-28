import { tz } from "@date-fns/tz";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { ZapIcon } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import * as z from "zod";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import { appointmentTypeColorClasses } from "#/lib/appointment-types.ts";
import { agendaViewOf } from "#/lib/appointments.ts";
import { layoutColumn, visibleHours } from "#/lib/calendar-layout.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { formatLocalDate, shiftDate, today, weekdayLabels, weekdayOf } from "#/lib/schedules.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";
import { getOfficeDayView } from "#/server/appointments.functions.ts";
import type { DayAppointment, DayColumn } from "#/server/appointments.ts";
import { getAvailabilityPractitioners } from "#/server/availability.functions.ts";
import { getOffices } from "#/server/offices.functions.ts";

import { AppointmentDialog } from "#/routes/_app/agenda/-appointment.tsx";
import type { PickedAppointment } from "#/routes/_app/agenda/-appointment.tsx";
import { BookingDialog } from "#/routes/_app/agenda/-booking.tsx";
import { StatusIcon, statusBlockClasses } from "#/routes/_app/agenda/-status.tsx";
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

/** The height of a minute on the day view, in pixels: 15 minutes are 24 px. */
const minuteHeight = 1.6;

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
      <div className="flex gap-2">
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
      <div className="flex flex-col gap-2">
        <Label htmlFor="officeId">Sede</Label>
        <NativeSelect id="officeId" name="officeId" defaultValue={props.officeId}>
          {props.offices.map((office) => (
            <NativeSelectOption key={office.id} value={office.id}>
              {office.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="date">Fecha</Label>
        <Input id="date" name="date" type="date" defaultValue={props.date} required />
      </div>
      <Button type="submit" variant="outline">
        Ver
      </Button>
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

function localTime(instant: Date, timeZone: string) {
  return format(instant, "HH:mm", { in: tz(timeZone) });
}

/** A length in minutes as the pixels it is drawn at on the day view. */
function px(minutes: number): string {
  return `${minutes * minuteHeight}px`;
}

/** Minutes from the view's start to `instant`. */
function offsetOf(instant: Date, view: TimeRange) {
  return (+instant - +view.start) / 60_000;
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
  const minutes = offsetOf(view.end, view);
  const hours = Array.from({ length: Math.floor(minutes / 60) }, (_, hour) => hour);

  return (
    <div className="flex overflow-x-auto rounded-xl border">
      <div className="w-14 shrink-0 border-r">
        <div className="h-10 border-b" />
        <div className="relative h-(--height)" style={{ "--height": px(minutes) } as CSSProperties}>
          {hours.map((hour) => (
            <span
              key={hour}
              className="text-muted-foreground absolute top-(--top) right-2 text-xs tabular-nums"
              style={{ "--top": px(hour * 60) } as CSSProperties}
            >
              {localTime(new Date(+view.start + hour * 3_600_000), props.timeZone)}
            </span>
          ))}
        </div>
      </div>
      {props.columns.map((column) => (
        <PractitionerColumn
          key={column.practitioner.id}
          column={column}
          view={view}
          hours={hours}
          timeZone={props.timeZone}
          onPick={props.onPick}
          onOpen={props.onOpen}
        />
      ))}
    </div>
  );
}

function PractitionerColumn(props: {
  column: DayColumn;
  view: TimeRange;
  hours: number[];
  timeZone: string;
  onPick: (slot: BookingSlot) => void;
  onOpen: (picked: PickedAppointment) => void;
}) {
  const { column, view, timeZone } = props;
  const appointments = new Map(column.appointments.map((booked) => [booked.id, booked]));
  const placed = layoutColumn(column.appointments, view);

  return (
    <div className="min-w-48 flex-1 border-r last:border-r-0">
      <div className="flex h-10 items-center border-b px-2 text-sm font-medium">
        {column.practitioner.displayName}
      </div>
      <div
        className="relative h-(--height)"
        style={{ "--height": px(offsetOf(view.end, view)) } as CSSProperties}
      >
        {props.hours.map((hour) => (
          <div
            key={hour}
            className="absolute inset-x-0 top-(--top) border-t"
            style={{ "--top": px(hour * 60) } as CSSProperties}
          />
        ))}
        {column.schedules.map((open) => (
          <div
            key={+open.start}
            className="bg-muted absolute inset-x-0 top-(--top) h-(--height)"
            style={
              {
                "--top": px(offsetOf(open.start, view)),
                "--height": px(offsetOf(open.end, view) - offsetOf(open.start, view)),
              } as CSSProperties
            }
          />
        ))}
        {column.freeStarts.map((free) => (
          <Button
            key={+free.start}
            variant="ghost"
            size="xs"
            className="absolute inset-x-1 top-(--top) h-(--height) justify-start"
            style={
              {
                "--top": px(offsetOf(free.start, view)),
                "--height": px(column.gridMinutes),
              } as CSSProperties
            }
            aria-label={`Dar turno a las ${localTime(free.start, timeZone)} con ${column.practitioner.displayName}`}
            onClick={() =>
              props.onPick({
                practitionerId: column.practitioner.id,
                practitionerName: column.practitioner.displayName,
                start: free.start,
                roomName: free.roomName,
                timeZone,
              })
            }
          >
            {localTime(free.start, timeZone)}
          </Button>
        ))}
        {placed.map((block) => (
          <AppointmentBlock
            key={block.id}
            block={block}
            appointment={appointments.get(block.id)!}
            timeZone={timeZone}
            onOpen={(appointment) =>
              props.onOpen({ appointment, practitioner: column.practitioner })
            }
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One appointment on the day view, in its lane, styled and marked by its
 * status; a sobreturno is dashed and marked.
 */
function AppointmentBlock(props: {
  block: ReturnType<typeof layoutColumn>[number];
  appointment: DayAppointment;
  timeZone: string;
  onOpen: (appointment: DayAppointment) => void;
}) {
  const { block, appointment: booked, timeZone } = props;
  return (
    <div
      className={cn(
        "absolute top-(--top) left-(--left) flex h-(--height) w-(--width) overflow-hidden rounded-md border text-xs",
        statusBlockClasses[booked.status],
        booked.overbooking && "border-dashed",
      )}
      style={
        {
          "--top": px(block.top),
          "--height": px(block.height),
          "--left": `${(block.lane / block.lanes) * 100}%`,
          "--width": `${100 / block.lanes}%`,
        } as CSSProperties
      }
      title={booked.receptionNote ?? undefined}
    >
      <div className={cn("w-1 shrink-0", appointmentTypeColorClasses[booked.color])} />
      <div className="flex min-w-0 flex-col items-start px-1.5 py-0.5">
        <Button
          variant="link"
          size="xs"
          className="max-w-full justify-start"
          onClick={() => props.onOpen(booked)}
        >
          <StatusIcon status={booked.status} />
          {booked.overbooking && <ZapIcon aria-label="Sobreturno" />}
          <span className="truncate">
            {localTime(booked.start, timeZone)} {booked.patientName}
          </span>
        </Button>
        <span className="text-muted-foreground truncate">
          {booked.typeName} · {booked.roomName}
        </span>
      </div>
    </div>
  );
}
