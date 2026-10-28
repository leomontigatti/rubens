import { tz } from "@date-fns/tz";
import { cn } from "cn";
import { ZapIcon } from "lucide-react";
import { format } from "date-fns";
import type { CSSProperties, ReactNode } from "react";

import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import { medicalServiceColorClasses } from "#/lib/medical-services.ts";
import { layoutColumn } from "#/lib/calendar-layout.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";
import type { DayAppointment, DayColumn } from "#/server/appointments.ts";

import { StatusIcon, statusBlockClasses } from "#/routes/_app/agenda/-status.tsx";
import type { BookingSlot } from "#/routes/_app/agenda/-booking.tsx";

// The pieces the day and week views share: the hour gutter, a column of one
// practitioner's schedules, free times and appointments, and an appointment
// block styled by its status.

/** The height of a minute on the calendar, in pixels: 15 minutes are 24 px. */
const minuteHeight = 1.6;

export function localTime(instant: Date, timeZone: string) {
  return format(instant, "HH:mm", { in: tz(timeZone) });
}

/** A length in minutes as the pixels it is drawn at on the calendar. */
export function px(minutes: number): string {
  return `${minutes * minuteHeight}px`;
}

/** Minutes from the view's start to `instant`. */
export function offsetOf(instant: Date, view: TimeRange) {
  return (+instant - +view.start) / 60_000;
}

/** The whole hours a view shows, from 0. */
function hoursOf(view: TimeRange): number[] {
  return Array.from({ length: Math.floor(offsetOf(view.end, view) / 60) }, (_, hour) => hour);
}

/**
 * A calendar picker's fields: what to view (an office, a practitioner), the
 * date, and the button that shows them. The form around them reads `name`
 * and `date`.
 */
export function ViewFields(props: {
  name: string;
  label: string;
  options: readonly { id: string; name: string }[];
  value: string;
  dateLabel: string;
  date: string;
}) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={props.name}>{props.label}</Label>
        <NativeSelect id={props.name} name={props.name} defaultValue={props.value}>
          {props.options.map((option) => (
            <NativeSelectOption key={option.id} value={option.id}>
              {option.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="date">{props.dateLabel}</Label>
        <Input id="date" name="date" type="date" defaultValue={props.date} required />
      </div>
      <Button type="submit" variant="outline">
        Ver
      </Button>
    </>
  );
}

/** The column of hour labels at the calendar's left. */
export function HourGutter(props: { view: TimeRange; timeZone: string }) {
  const { view } = props;
  return (
    <div className="w-14 shrink-0 border-r">
      <div className="h-10 border-b" />
      <div
        className="relative h-(--height)"
        style={{ "--height": px(offsetOf(view.end, view)) } as CSSProperties}
      >
        {hoursOf(view).map((hour) => (
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
  );
}

/** The column's background: a line each hour, and a band per range. */
export function ColumnBackground(props: { view: TimeRange; bands: readonly TimeRange[] }) {
  const { view } = props;
  return (
    <>
      {hoursOf(view).map((hour) => (
        <div
          key={hour}
          className="absolute inset-x-0 top-(--top) border-t"
          style={{ "--top": px(hour * 60) } as CSSProperties}
        />
      ))}
      {props.bands.map((band) => (
        <div
          key={+band.start}
          className="bg-muted absolute inset-x-0 top-(--top) h-(--height)"
          style={
            {
              "--top": px(offsetOf(band.start, view)),
              "--height": px(offsetOf(band.end, view) - offsetOf(band.start, view)),
            } as CSSProperties
          }
        />
      ))}
    </>
  );
}

/**
 * One practitioner's column for a day: their schedules shaded, a button per
 * free time, and their appointments in lanes.
 */
export function PractitionerColumn(props: {
  title: ReactNode;
  practitioner: { id: string; displayName: string };
  column: Omit<DayColumn, "practitioner">;
  view: TimeRange;
  timeZone: string;
  onPick: (slot: BookingSlot) => void;
  onOpen: (appointment: DayAppointment) => void;
}) {
  const { column, view, timeZone, practitioner } = props;
  const appointments = new Map(column.appointments.map((booked) => [booked.id, booked]));
  const placed = layoutColumn(column.appointments, view);

  return (
    <div className="min-w-48 flex-1 border-r last:border-r-0">
      <div className="flex h-10 items-center border-b px-2 text-sm font-medium">{props.title}</div>
      <div
        className="relative h-(--height)"
        style={{ "--height": px(offsetOf(view.end, view)) } as CSSProperties}
      >
        <ColumnBackground view={view} bands={column.schedules} />
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
            aria-label={`Dar turno a las ${localTime(free.start, timeZone)} con ${practitioner.displayName}`}
            onClick={() =>
              props.onPick({
                practitionerId: practitioner.id,
                practitionerName: practitioner.displayName,
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
            onOpen={props.onOpen}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One appointment on the calendar, in its lane, styled and marked by its
 * status; an overbooking is dashed and marked.
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
      <div className={cn("w-1 shrink-0", medicalServiceColorClasses[booked.color])} />
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
