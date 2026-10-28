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
import { layoutCells, layoutColumn } from "#/lib/calendar-layout.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";
import type { DayAppointment, DayColumn } from "#/server/appointments.ts";

import { StatusIcon, statusBlockClasses } from "#/routes/_app/agenda/-status.tsx";
import type { BookingSlot } from "#/routes/_app/agenda/-booking.tsx";

// The pieces the day, week and room views share: the time axis, a column of
// one practitioner's 30-minute cells and appointment cards, and a card styled
// by its status.

/** The height of a minute on the calendar, in pixels: a 30-minute cell is 48 px. */
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

/** The time axis at the calendar's left: each row's start, on its line. */
export function TimeAxis(props: { view: TimeRange; timeZone: string }) {
  const { view } = props;
  return (
    <div className="w-14 shrink-0 border-r">
      <div className="h-10 border-b" />
      <div
        className="relative h-(--height)"
        style={{ "--height": px(offsetOf(view.end, view)) } as CSSProperties}
      >
        {layoutCells(view, []).map((row) => (
          <span
            key={row.top}
            className="text-muted-foreground absolute top-(--top) right-2 -translate-y-1/2 bg-background px-0.5 text-xs tabular-nums"
            style={{ "--top": px(row.top) } as CSSProperties}
          >
            {localTime(row.start, props.timeZone)}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * One practitioner's column for a day: a stack of 30-minute cells, white and
 * bookable where wholly free, grey elsewhere, under their appointment cards.
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
  const cells = layoutCells(view, column.freeStarts);

  return (
    <div className="min-w-48 flex-1 border-r last:border-r-0">
      <div className="flex h-10 items-center border-b px-2 text-sm font-medium">{props.title}</div>
      <div
        className="relative h-(--height)"
        style={{ "--height": px(offsetOf(view.end, view)) } as CSSProperties}
      >
        {cells.map(({ top, height, free }) => (
          <div
            key={top}
            className={cn(
              "absolute inset-x-0 top-(--top) h-(--height) border-t",
              free ? "bg-background" : "bg-muted",
            )}
            style={{ "--top": px(top), "--height": px(height) } as CSSProperties}
          >
            {free && (
              <Button
                variant="ghost"
                className="size-full"
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
              />
            )}
          </div>
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
 * One appointment card on the calendar, in its lane, styled and marked by its
 * status; an overbooking is dashed and marked. A cancelled or no-show card,
 * shown only when asked for, is faded and lets clicks through to the cell
 * under it but for its patient's name.
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
          className="pointer-events-auto max-w-full justify-start"
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
