import { tz } from "@date-fns/tz";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
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
import type { DayColumn } from "#/server/appointments.ts";
import { getAvailabilityPractitioners } from "#/server/availability.functions.ts";
import { getOffices } from "#/server/offices.functions.ts";

import { BookingDialog } from "#/routes/_app/agenda/-booking.tsx";
import type { BookingSlot } from "#/routes/_app/agenda/-booking.tsx";

// Reception's main screen: one office's day, a column per practitioner. What
// is being viewed lives in the URL; a value that does not parse falls back to
// its default, the first office and today.
const searchSchema = z.object({
  sede: z.uuid().optional().catch(undefined),
  fecha: z.iso.date().optional().catch(undefined),
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
      day: await dayOf(view),
    };
  },
  component: Agenda,
});

function dayOf({ officeId, date }: { officeId: string | null; date: string }) {
  return officeId === null ? null : getOfficeDayView({ data: { officeId, date } });
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

function Agenda() {
  const result = Route.useLoaderData();
  const [slot, setSlot] = useState<BookingSlot | null>(null);
  const [booking, setBooking] = useState(false);

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }

  function openBooking(picked: BookingSlot | null) {
    setSlot(picked);
    setBooking(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <Button onClick={() => openBooking(null)}>Nuevo turno</Button>
      </div>
      {result.officeId === null ? (
        <p className="text-muted-foreground">Todavía no hay sedes.</p>
      ) : (
        <DayPicker offices={result.offices} officeId={result.officeId} date={result.date} />
      )}
      <DayResult day={result.day} date={result.date} onPick={openBooking} />
      <BookingDialog
        open={booking}
        onOpenChange={setBooking}
        slot={slot}
        practitioners={result.practitioners}
        defaultDate={result.date}
      />
    </div>
  );
}

function DayResult(props: {
  day: Awaited<ReturnType<typeof dayOf>>;
  date: string;
  onPick: (slot: BookingSlot) => void;
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
    />
  );
}

function DayPicker(props: {
  offices: { id: string; name: string }[];
  officeId: string;
  date: string;
}) {
  const navigate = useNavigate();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const search = searchSchema.parse({
      sede: form.get("officeId") || undefined,
      fecha: form.get("date") || undefined,
    });
    void navigate({ to: "/agenda", search });
  }

  const linkTo = (date: string) => ({ sede: props.officeId, fecha: date });

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
        {placed.map((block) => {
          const booked = appointments.get(block.id)!;
          return (
            <div
              key={block.id}
              className="bg-background absolute top-(--top) left-(--left) flex h-(--height) w-(--width) overflow-hidden rounded-md border text-xs"
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
              <div className="flex min-w-0 flex-col px-1.5 py-0.5">
                <span className="truncate font-medium">
                  {localTime(booked.start, timeZone)} {booked.patientName}
                </span>
                <span className="text-muted-foreground truncate">
                  {booked.typeName} · {booked.roomName}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
