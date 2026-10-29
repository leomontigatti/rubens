import { tz } from "@date-fns/tz";
import { cn } from "cn";
import { ZapIcon } from "lucide-react";
import { format } from "date-fns";
import type { CSSProperties, ReactNode } from "react";

import { Button } from "#/components/ui/button.tsx";
import { layoutCells, layoutColumn, layoutDay } from "#/lib/calendar-layout.ts";
import type { PlacedBlock } from "#/lib/calendar-layout.ts";
import { activeAppointmentStatuses } from "#/lib/appointments.ts";
import { practitionerColorClasses } from "#/lib/practitioner-colors.ts";
import { formatLocalDate, weekdayLabels, weekdayOf } from "#/lib/schedules.ts";
import type { TimeRange } from "#/lib/time-ranges.ts";
import type { BusyBlock, CalendarAppointment, CalendarDay } from "#/server/calendar-week.ts";

import { StatusIcon } from "#/routes/_app/agenda/-status.tsx";

// The calendar's pieces (docs/domain/appointments.md § Calendar): the time
// axis, and a day's column of 30-minute cells, white and bookable where free,
// under its cards, which sit side by side and never overlap. Another
// practitioner's busy block, with its time and practitioner, covers the whole width of its cells, white ones
// included, under the viewer's own cards.

/** The height of a minute on the calendar, in pixels: a 30-minute cell is 48 px. */
const minuteHeight = 1.6;

function localTime(instant: Date, timeZone: string) {
  return format(instant, "HH:mm", { in: tz(timeZone) });
}

/** A length in minutes as the pixels it is drawn at on the calendar. */
function px(minutes: number): string {
  return `${minutes * minuteHeight}px`;
}

interface InLane {
  lane: number;
  lanes: number;
}

/** Where a lane starts, as a share of the column's width. */
function laneLeft(placed: InLane): string {
  return `${(placed.lane / placed.lanes) * 100}%`;
}

/** A lane's width, as a share of the column's. */
function laneWidth(placed: InLane): string {
  return `${100 / placed.lanes}%`;
}

function offsetOf(instant: Date, view: TimeRange) {
  return (+instant - +view.start) / 60_000;
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
            className="text-muted-foreground bg-background absolute top-(--top) right-2 -translate-y-1/2 px-0.5 text-xs tabular-nums"
            style={{ "--top": px(row.top) } as CSSProperties}
          >
            {localTime(row.start, props.timeZone)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A free cell clicked: its start and the practitioners free from it. */
export interface PickedCell {
  start: Date;
  practitionerIds: string[];
}

/**
 * One day of the week: a stack of 30-minute cells, white and bookable where a
 * practitioner is free, grey elsewhere, under the day's appointments in lanes.
 */
export function DayColumn(props: {
  title: ReactNode;
  day: CalendarDay;
  view: TimeRange;
  timeZone: string;
  onPick: (cell: PickedCell) => void;
  onOpen: (appointment: CalendarAppointment) => void;
}) {
  const { day, view, timeZone } = props;
  const appointments = day.cards.filter((card) => card.kind === "appointment");
  const byId = new Map(appointments.map((card) => [card.id, card]));
  const placed = layoutDay(view, day.freeStarts, appointments);
  const busyCards = day.cards.filter((card) => card.kind === "busy");
  const busyById = new Map(busyCards.map((card) => [card.id, card]));
  const busy = layoutColumn(busyCards, view);
  const dateLabel = `${weekdayLabels[weekdayOf(day.date)]} ${formatLocalDate(day.date)}`;

  return (
    <div className="min-w-36 flex-1 border-r last:border-r-0">
      <div className="flex h-10 items-center border-b px-2 text-sm font-medium">{props.title}</div>
      <div
        className="relative h-(--height)"
        style={{ "--height": px(offsetOf(view.end, view)) } as CSSProperties}
      >
        {placed.cells.map(({ start, top, height, free, lane, lanes }) => (
          <div
            key={top}
            className={cn(
              "absolute inset-x-0 top-(--top) h-(--height) border-t",
              free.length > 0 ? "bg-background" : "bg-muted",
            )}
            style={{ "--top": px(top), "--height": px(height) } as CSSProperties}
          >
            {free.length > 0 && (
              <Button
                variant="ghost"
                className="absolute left-(--left) h-full w-(--width)"
                style={
                  {
                    "--left": laneLeft({ lane, lanes }),
                    "--width": laneWidth({ lane, lanes }),
                  } as CSSProperties
                }
                aria-label={`Dar turno el ${dateLabel} a las ${localTime(start, timeZone)}`}
                onClick={() =>
                  props.onPick({ start, practitionerIds: free.map((one) => one.practitionerId) })
                }
              />
            )}
          </div>
        ))}
        {busy.map((block) => (
          <BusyCard
            key={block.id}
            block={block}
            busy={busyById.get(block.id)!}
            timeZone={timeZone}
          />
        ))}
        {placed.cards.map((block) => (
          <AppointmentCard
            key={block.id}
            block={block}
            appointment={byId.get(block.id)!}
            timeZone={timeZone}
            onOpen={props.onOpen}
          />
        ))}
      </div>
    </div>
  );
}

const activeStatuses: readonly string[] = activeAppointmentStatuses;

/**
 * An appointment in its practitioner's colour: its status as an icon, the
 * time, the patient and the medical service. Cancelled and no-show ones,
 * drawn only when asked for, are faded; an overbooking is dashed and marked.
 */
function AppointmentCard(props: {
  block: PlacedBlock;
  appointment: CalendarAppointment;
  timeZone: string;
  onOpen: (appointment: CalendarAppointment) => void;
}) {
  const { block, appointment: card } = props;
  return (
    <div
      className={cn(
        "bg-background absolute top-(--top) left-(--left) flex h-(--height) w-(--width) overflow-hidden rounded-md border text-xs",
        card.overbooking && "border-dashed",
        !activeStatuses.includes(card.status) && "opacity-50",
      )}
      style={
        {
          "--top": px(block.top),
          "--height": px(block.height),
          "--left": laneLeft(block),
          "--width": laneWidth(block),
        } as CSSProperties
      }
      title={card.receptionNote ?? undefined}
    >
      <div className={cn("w-1 shrink-0", practitionerColorClasses[card.color])} />
      <div className="flex min-w-0 flex-1 flex-col items-start px-1.5 py-0.5">
        <CardHeading appointment={card} timeZone={props.timeZone} onOpen={props.onOpen} />
        <span className="text-muted-foreground max-w-full truncate">
          {card.medicalServiceName} · {card.practitionerName}
        </span>
      </div>
    </div>
  );
}

/** The button that opens the appointment: its status, overbooking mark, time and patient. */
function CardHeading(props: {
  appointment: CalendarAppointment;
  timeZone: string;
  onOpen: (appointment: CalendarAppointment) => void;
}) {
  const { appointment: card } = props;
  return (
    <Button
      variant="link"
      size="xs"
      className="max-w-full justify-start"
      onClick={() => props.onOpen(card)}
    >
      <StatusIcon status={card.status} />
      {card.overbooking && <ZapIcon role="img" aria-label="Sobreturno" />}
      <span className="truncate">
        {localTime(card.start, props.timeZone)} {card.patientName}
      </span>
    </Button>
  );
}

/**
 * Another practitioner's appointment, as a practitioner sees it: a grey block,
 * the column's width, with its time and practitioner and nothing about the patient.
 */
function BusyCard(props: { block: PlacedBlock; busy: BusyBlock; timeZone: string }) {
  const { block, busy } = props;
  return (
    <div
      className="bg-muted text-muted-foreground absolute inset-x-0 top-(--top) h-(--height) truncate rounded-md border px-1.5 py-0.5 text-xs"
      style={{ "--top": px(block.top), "--height": px(block.height) } as CSSProperties}
    >
      {localTime(busy.start, props.timeZone)} {busy.practitionerName}
    </div>
  );
}
