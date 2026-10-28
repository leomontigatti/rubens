import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { ZapIcon } from "lucide-react";
import type { CSSProperties, FormEvent } from "react";
import * as z from "zod";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { Button } from "#/components/ui/button.tsx";
import { agendaViewOf } from "#/lib/appointments.ts";
import { layoutCells, layoutColumn, visibleHours } from "#/lib/calendar-layout.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { formatLocalDate, shiftDate, today, weekdayLabels, weekdayOf } from "#/lib/schedules.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";
import { getRoomDayView } from "#/server/appointments.functions.ts";
import { getOffices } from "#/server/offices.functions.ts";
import type { RoomBlock, RoomColumn } from "#/server/room-day.ts";

import { localTime, offsetOf, px, TimeAxis, ViewFields } from "#/routes/_app/agenda/-calendar.tsx";

// The room view (ui: "Consultorios"): one office's day, a column per room,
// showing which practitioner holds it and when, by schedules and
// appointments. Open to all staff, so no patient is ever named. What is viewed
// lives in the URL, as on the day view.
const searchSchema = z.object({
  sede: z.uuid().optional().catch(undefined),
  fecha: z.iso.date().optional().catch(undefined),
});

export const Route = createFileRoute("/_app/agenda/consultorios")({
  head: () => ({ meta: [{ title: "Consultorios · Agenda · Rubens" }] }),
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const offices = await getOffices({ data: { includeInactive: false } });
    if (!offices.ok) {
      return offices;
    }
    const view = agendaViewOf(deps, offices.offices, today(defaultTimeZone));
    return {
      ok: true as const,
      offices: offices.offices,
      ...view,
      day: await roomDayOf(view),
    };
  },
  component: Rooms,
});

function roomDayOf(view: { officeId: string | null; date: string }) {
  const { officeId, date } = view;
  return officeId === null ? null : getRoomDayView({ data: { officeId, date } });
}

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Tu rol no permite ver los consultorios.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá la sede y la fecha.",
  notFound: "No encontramos esa sede.",
};

function Rooms() {
  const result = Route.useLoaderData();
  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">Consultorios</h1>
        <Button variant="outline" nativeButton={false} render={<Link to="/agenda" />}>
          Ver la agenda
        </Button>
      </div>
      {result.officeId === null ? (
        <p className="text-muted-foreground">Todavía no hay sedes.</p>
      ) : (
        <RoomDayPicker offices={result.offices} officeId={result.officeId} date={result.date} />
      )}
      <RoomDayResult day={result.day} date={result.date} />
    </div>
  );
}

function RoomDayResult(props: { day: Awaited<ReturnType<typeof roomDayOf>>; date: string }) {
  if (!props.day) {
    return null;
  }
  if (!props.day.ok) {
    return <RefusalMessage message={refusalMessages[props.day.reason]} />;
  }
  return (
    <RoomDayView date={props.date} timeZone={props.day.office.timeZone} rooms={props.day.rooms} />
  );
}

function RoomDayPicker(props: {
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
    void navigate({ to: "/agenda/consultorios", search });
  }

  const linkTo = (date: string) => ({ sede: props.officeId, fecha: date });

  return (
    <form
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
          render={<Link to="/agenda/consultorios" search={linkTo(shiftDate(props.date, -1))} />}
        >
          Día anterior
        </Button>
        <span className="text-sm font-medium">
          {weekdayLabels[weekdayOf(props.date)]} {formatLocalDate(props.date)}
        </span>
        <Button
          variant="ghost"
          nativeButton={false}
          render={<Link to="/agenda/consultorios" search={linkTo(shiftDate(props.date, 1))} />}
        >
          Día siguiente
        </Button>
      </div>
    </form>
  );
}

function RoomDayView(props: { date: string; timeZone: string; rooms: RoomColumn[] }) {
  if (props.rooms.length === 0) {
    return <p className="text-muted-foreground">Esta sede no tiene consultorios.</p>;
  }
  const view = visibleHours(
    props.rooms.flatMap((room) => room.blocks),
    props.date,
    props.timeZone,
  );
  return (
    <div className="flex overflow-x-auto rounded-xl border">
      <TimeAxis view={view} timeZone={props.timeZone} />
      {props.rooms.map((room) => (
        <RoomDayColumn key={room.id} room={room} view={view} timeZone={props.timeZone} />
      ))}
    </div>
  );
}

/**
 * One room's day on grey 30-minute rows: each schedule that holds it as a
 * white block, the appointments in it as cards in lanes, each by
 * practitioner, and over them all the schedules' practitioners named at their
 * blocks' top left.
 */
function RoomDayColumn(props: { room: RoomColumn; view: TimeRange; timeZone: string }) {
  const { room, view, timeZone } = props;
  const schedules = room.blocks.filter((block) => block.kind === "schedule");
  const appointments = room.blocks
    .filter((block) => block.kind === "appointment")
    .map((block, index) => ({ ...block, id: String(index) }));
  const byId = new Map(appointments.map((block) => [block.id, block]));
  const scheduleStarts = new Set(schedules.map((held) => +held.start));

  return (
    <div className="min-w-40 flex-1 border-r last:border-r-0">
      <div className="flex h-10 items-center border-b px-2 text-sm font-medium">{room.name}</div>
      <div
        className="relative h-(--height)"
        style={{ "--height": px(offsetOf(view.end, view)) } as CSSProperties}
      >
        {layoutCells(view, []).map(({ top, height }) => (
          <div
            key={top}
            className="bg-muted absolute inset-x-0 top-(--top) h-(--height) border-t"
            style={{ "--top": px(top), "--height": px(height) } as CSSProperties}
          />
        ))}
        {schedules.map((held) => (
          <div
            key={`${+held.start} ${held.practitionerName}`}
            className="bg-background absolute inset-x-0 top-(--top) h-(--height) border-y"
            style={
              {
                "--top": px(offsetOf(held.start, view)),
                "--height": px(offsetOf(held.end, view) - offsetOf(held.start, view)),
              } as CSSProperties
            }
          />
        ))}
        {layoutColumn(appointments, view).map((placed) => {
          const held = byId.get(placed.id)!;
          return (
            <RoomAppointment
              key={placed.id}
              held={held}
              placed={placed}
              timeZone={timeZone}
              belowLabel={scheduleStarts.has(+held.start)}
            />
          );
        })}
        {scheduleLabels(schedules).map(({ start, names }) => (
          <span
            key={+start}
            className="bg-background absolute top-(--top) left-0 z-10 max-w-full truncate rounded-br-md px-1.5 text-xs leading-4 font-medium"
            style={{ "--top": px(offsetOf(start, view)) } as CSSProperties}
          >
            {names.join(" · ")}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The schedules' practitioners by start: schedules starting together share one label. */
function scheduleLabels(schedules: readonly RoomBlock[]) {
  const byStart = new Map<number, { start: Date; names: string[] }>();
  for (const held of schedules) {
    const label = byStart.get(+held.start) ?? { start: held.start, names: [] };
    label.names.push(held.practitionerName);
    byStart.set(+held.start, label);
  }
  return [...byStart.values()];
}

/**
 * An appointment holding the room: when, and with which practitioner; never
 * the patient. One starting with a schedule keeps its text below the
 * schedule's label.
 */
function RoomAppointment(props: {
  held: RoomBlock;
  placed: ReturnType<typeof layoutColumn>[number];
  timeZone: string;
  belowLabel: boolean;
}) {
  const { held, placed, timeZone } = props;
  return (
    <div
      className={cn(
        "bg-background absolute top-(--top) left-(--left) flex h-(--height) w-(--width) items-start gap-1 overflow-hidden rounded-md border px-1.5 py-0.5 text-xs",
        held.overbooking && "border-dashed",
        props.belowLabel && "pt-4",
      )}
      style={
        {
          "--top": px(placed.top),
          "--height": px(placed.height),
          "--left": `${(placed.lane / placed.lanes) * 100}%`,
          "--width": `${100 / placed.lanes}%`,
        } as CSSProperties
      }
    >
      {held.overbooking && <ZapIcon aria-label="Sobreturno" className="size-3 shrink-0" />}
      <span className="truncate">
        {localTime(held.start, timeZone)} {held.practitionerName}
      </span>
    </div>
  );
}
