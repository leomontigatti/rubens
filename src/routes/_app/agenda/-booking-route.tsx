import * as z from "zod";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { defaultTimeZone } from "#/lib/offices.ts";
import { today } from "#/lib/schedules.ts";
import { getCalendarWeekView } from "#/server/appointments.functions.ts";
import { getAvailabilityPractitioners } from "#/server/availability.functions.ts";

import { BookingPage } from "#/routes/_app/agenda/-booking.tsx";

// What a booking's page reads from its URL and loads, `Nuevo turno`'s and
// `Sobreturno`'s alike: the room viewed on the calendar, for its name, zone
// and office; and, from a clicked cell or an appointment, the start and whom
// it is for. A value that does not parse falls back to none, as on the calendar.

export const bookingSearchSchema = z.object({
  consultorio: z.uuid().optional().catch(undefined),
  fecha: z.iso.date().optional().catch(undefined),
  prestacion: z.uuid().optional().catch(undefined),
  inicio: z.iso.datetime({ offset: true }).optional().catch(undefined),
  profesionales: z.array(z.uuid()).optional().catch(undefined),
});

type BookingSearch = z.infer<typeof bookingSearchSchema>;

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo recepción, un administrador o un profesional pueden dar turnos.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá el consultorio y la fecha.",
  notFound: "No encontramos ese consultorio.",
};

export async function loadBooking(search: BookingSearch) {
  const date = search.fecha ?? today(defaultTimeZone);
  const [calendar, practitioners] = await Promise.all([
    getCalendarWeekView({
      data: {
        roomId: search.consultorio,
        date,
        medicalServiceId: search.prestacion,
        includeCancelledAndNoShow: false,
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
    search: { ...search, fecha: date },
  };
}

type LoadedBooking = Awaited<ReturnType<typeof loadBooking>>;

/** Whom the page books for: those the URL names, or everyone the viewer books for. */
function chosenPractitioners<T extends { id: string }>(all: T[], picked: string[] | undefined) {
  return picked ? all.filter((one) => picked.includes(one.id)) : all;
}

type Week = NonNullable<Extract<LoadedBooking, { ok: true }>["week"]>;

/**
 * Where the URL's start is: the room viewed. A booking from a clicked cell
 * also starts on the medical service the calendar is narrowed to.
 */
function bookingStartOf(inicio: string | undefined, week: Week, overbooking: boolean) {
  if (!inicio) {
    return null;
  }
  const medicalService = week.medicalServices.find(
    (one) => one.id === week.filter.medicalServiceId,
  );
  return {
    start: new Date(inicio),
    roomName: week.room.name,
    timeZone: week.office.timeZone,
    medicalService: overbooking ? null : medicalService,
  };
}

/** The page of a booking or an overbooking, from what `loadBooking` read. */
export function BookingRoute({
  loaded,
  overbooking,
}: {
  loaded: LoadedBooking;
  overbooking: boolean;
}) {
  if (!loaded.ok) {
    return <RefusalMessage message={refusalMessages[loaded.reason]} />;
  }
  const { week, search } = loaded;
  if (!week) {
    return <RefusalMessage message="No hay consultorios activos. Agregalos en Sedes." />;
  }
  const { office } = week;
  return (
    <BookingPage
      back={{ to: "/agenda", search: { consultorio: week.room.id, fecha: search.fecha } }}
      from={bookingStartOf(search.inicio, week, overbooking)}
      practitioners={chosenPractitioners(loaded.practitioners, search.profesionales)}
      defaultDate={search.fecha}
      overbooking={overbooking ? { rooms: office.rooms, timeZone: office.timeZone } : null}
    />
  );
}
