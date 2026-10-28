import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import * as z from "zod";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { Button } from "#/components/ui/button.tsx";
import { visibleWeekHours } from "#/lib/calendar-layout.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { formatLocalDate, shiftDate, today, weekdayLabels, weekdayOf } from "#/lib/schedules.ts";
import { weekViewOf } from "#/lib/appointments.ts";
import { getPractitionerWeekView } from "#/server/appointments.functions.ts";
import type { DayAppointment } from "#/server/appointments.ts";
import { getAvailabilityPractitioners } from "#/server/availability.functions.ts";
import type { WeekOffice, getPractitionerWeek } from "#/server/practitioner-week.ts";

import { AppointmentDialog } from "#/routes/_app/agenda/-appointment.tsx";
import { BookingDialog } from "#/routes/_app/agenda/-booking.tsx";
import type { BookingSlot } from "#/routes/_app/agenda/-booking.tsx";
import { TimeAxis, PractitionerColumn, ViewFields } from "#/routes/_app/agenda/-calendar.tsx";

// The week view of one practitioner (ui: "Semana"): seven days from a date,
// in the organization's zone, a column per day. A practitioner sees only
// their own. What is viewed lives in the URL; a value that does not parse
// falls back to its default, the first practitioner and today.
const searchSchema = z.object({
  profesional: z.uuid().optional().catch(undefined),
  fecha: z.iso.date().optional().catch(undefined),
  cancelados: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute("/_app/agenda/semana")({
  head: () => ({ meta: [{ title: "Semana · Agenda · Rubens" }] }),
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const practitioners = await getAvailabilityPractitioners();
    if (!practitioners.ok) {
      return practitioners;
    }
    const view = weekViewOf(deps, practitioners.practitioners, today(defaultTimeZone));
    return {
      ok: true as const,
      practitioners: practitioners.practitioners,
      ...view,
      week: await weekOf(view),
    };
  },
  component: Week,
});

function weekOf(view: ReturnType<typeof weekViewOf>) {
  const { practitionerId, date, includeCancelledAndNoShow } = view;
  return practitionerId === null
    ? null
    : getPractitionerWeekView({ data: { practitionerId, date, includeCancelledAndNoShow } });
}

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo recepción, un administrador o el propio profesional pueden ver su semana.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá el profesional y la fecha.",
  notFound: "No encontramos ese profesional.",
};

type LoadedWeek = Extract<Awaited<ReturnType<typeof getPractitionerWeek>>, { ok: true }>;

/** The office of the appointment clicked, as the appointment and booking dialogs take it. */
function officeOf(offices: readonly WeekOffice[], appointment: DayAppointment | null) {
  return offices.find((office) => office.id === appointment?.officeId) ?? null;
}

function Week() {
  const result = Route.useLoaderData();
  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">Semana</h1>
        <Button variant="outline" nativeButton={false} render={<Link to="/agenda" />}>
          Ver el día de una sede
        </Button>
      </div>
      {result.practitionerId === null ? (
        <p className="text-muted-foreground">Todavía no hay profesionales.</p>
      ) : (
        <WeekPicker
          practitioners={result.practitioners}
          practitionerId={result.practitionerId}
          date={result.date}
          showCancelledAndNoShow={result.includeCancelledAndNoShow}
        />
      )}
      <WeekResult week={result.week} practitioners={result.practitioners} date={result.date} />
    </div>
  );
}

function WeekResult(props: {
  week: Awaited<ReturnType<typeof weekOf>>;
  practitioners: { id: string; displayName: string }[];
  date: string;
}) {
  if (!props.week) {
    return null;
  }
  if (!props.week.ok) {
    return <RefusalMessage message={refusalMessages[props.week.reason]} />;
  }
  return <WeekCalendar week={props.week} practitioners={props.practitioners} date={props.date} />;
}

function WeekPicker(props: {
  practitioners: { id: string; displayName: string }[];
  practitionerId: string;
  date: string;
  showCancelledAndNoShow: boolean;
}) {
  const navigate = useNavigate();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const search = searchSchema.parse({
      profesional: form.get("practitionerId") || undefined,
      fecha: form.get("date") || undefined,
      cancelados: props.showCancelledAndNoShow || undefined,
    });
    void navigate({ to: "/agenda/semana", search });
  }

  const linkTo = (date: string, showCancelledAndNoShow = props.showCancelledAndNoShow) => ({
    profesional: props.practitionerId,
    fecha: date,
    cancelados: showCancelledAndNoShow || undefined,
  });

  return (
    <form
      // Remounting on a new week resets the fields to what is being viewed.
      key={`${props.practitionerId} ${props.date}`}
      onSubmit={submit}
      className="flex flex-wrap items-end gap-4"
    >
      <ViewFields
        name="practitionerId"
        label="Profesional"
        options={props.practitioners.map((practitioner) => ({
          id: practitioner.id,
          name: practitioner.displayName,
        }))}
        value={props.practitionerId}
        dateLabel="Desde"
        date={props.date}
      />
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          nativeButton={false}
          render={<Link to="/agenda/semana" search={linkTo(shiftDate(props.date, -7))} />}
        >
          Semana anterior
        </Button>
        <Button
          variant="ghost"
          nativeButton={false}
          render={<Link to="/agenda/semana" search={linkTo(shiftDate(props.date, 7))} />}
        >
          Semana siguiente
        </Button>
      </div>
      <Button
        variant="ghost"
        nativeButton={false}
        render={
          <Link to="/agenda/semana" search={linkTo(props.date, !props.showCancelledAndNoShow)} />
        }
      >
        {props.showCancelledAndNoShow
          ? "Ocultar cancelados y ausentes"
          : "Mostrar cancelados y ausentes"}
      </Button>
    </form>
  );
}

/** The booking dialog: open on a free time, or on an overbooking over an appointment. */
interface BookingStart {
  open: boolean;
  slot: BookingSlot | null;
  overbooking: WeekOffice | null;
}

const closedBooking: BookingStart = { open: false, slot: null, overbooking: null };

function WeekCalendar(props: {
  week: LoadedWeek;
  practitioners: { id: string; displayName: string }[];
  date: string;
}) {
  const { week } = props;
  const [booking, setBooking] = useState<BookingStart>(closedBooking);
  const [picked, setPicked] = useState<DayAppointment | null>(null);
  const views = visibleWeekHours(
    week.days.map((day) => ({ date: day.date, ranges: [...day.schedules, ...day.appointments] })),
    defaultTimeZone,
  );

  return (
    <>
      <div className="flex overflow-x-auto rounded-xl border">
        <TimeAxis view={views[0]!} timeZone={defaultTimeZone} />
        {week.days.map((day, index) => (
          <PractitionerColumn
            key={day.date}
            title={`${weekdayLabels[weekdayOf(day.date)]} ${formatLocalDate(day.date)}`}
            practitioner={week.practitioner}
            column={day}
            view={views[index]!}
            timeZone={defaultTimeZone}
            onPick={(slot) => setBooking({ open: true, slot, overbooking: null })}
            onOpen={setPicked}
          />
        ))}
      </div>
      <WeekDialogs
        week={week}
        practitioners={props.practitioners}
        date={props.date}
        booking={booking}
        onBook={setBooking}
        picked={picked}
        onPick={setPicked}
      />
    </>
  );
}

/** The booking dialog, and the dialog of the appointment clicked, in its own office. */
function WeekDialogs(props: {
  week: LoadedWeek;
  practitioners: { id: string; displayName: string }[];
  date: string;
  booking: BookingStart;
  onBook: (booking: BookingStart) => void;
  picked: DayAppointment | null;
  onPick: (picked: DayAppointment | null) => void;
}) {
  const { booking, picked } = props;
  const office = officeOf(props.week.offices, picked);
  return (
    <>
      <BookingDialog
        open={booking.open}
        onOpenChange={(open) => props.onBook({ ...booking, open })}
        slot={booking.slot}
        practitioners={props.practitioners}
        defaultDate={props.date}
        overbooking={booking.overbooking}
      />
      <AppointmentDialog
        picked={picked && { appointment: picked, practitioner: props.week.practitioner }}
        onClose={() => props.onPick(null)}
        office={office}
        onOverbook={(slot) => {
          props.onPick(null);
          props.onBook({ open: true, slot, overbooking: office });
        }}
      />
    </>
  );
}
