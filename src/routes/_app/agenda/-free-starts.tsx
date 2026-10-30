import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";

import { ErrorAlert } from "#/components/admin-form.tsx";
import { Button } from "#/components/ui/button.tsx";
import { freeStartsByDay } from "#/lib/availability.ts";
import type { AvailabilityQuery } from "#/lib/availability.ts";
import type { PickedStart } from "#/lib/booking-draft.ts";
import { getFreeTimes } from "#/server/availability.functions.ts";
import type { AvailableStart } from "#/server/availability.ts";

// A practitioner's free starts to pick one from, by day: booking's and
// rescheduling's picker, and the fresh ones after a time was taken.

/** The practitioner's free starts for the query's duration and week, to pick one. */
export function FreeStartsOfWeek(props: {
  query: AvailabilityQuery;
  picked: PickedStart | null;
  onPick: (start: PickedStart) => void;
}) {
  const { viewer } = useRouteContext({ from: "/_app" });
  const { data } = useQuery({
    queryKey: ["freeTimes", viewer.organizationId, viewer.userId, props.query],
    queryFn: () => getFreeTimes({ data: props.query }),
    placeholderData: keepPreviousData,
  });

  if (!data) {
    return null;
  }
  if (!data.ok) {
    return <ErrorAlert message="No encontramos los horarios libres de ese profesional." />;
  }
  if (data.freeStarts.length === 0) {
    return <p className="text-muted-foreground text-sm">No hay horarios libres esa semana.</p>;
  }
  return <FreeStartList starts={data.freeStarts} picked={props.picked} onPick={props.onPick} />;
}

export function FreeStartList(props: {
  starts: AvailableStart[];
  picked: PickedStart | null;
  onPick: (start: PickedStart) => void;
}) {
  return (
    <div className="flex max-h-60 flex-col gap-3 overflow-y-auto">
      {freeStartsByDay(props.starts).map((day) => (
        <div key={day.date} className="flex flex-col gap-1">
          <p className="text-sm font-medium">{day.label}</p>
          <div className="flex flex-wrap gap-1">
            {day.starts.map((free) => (
              <Button
                key={+free.start}
                type="button"
                size="xs"
                variant={+free.start === +(props.picked?.start ?? 0) ? "default" : "outline"}
                title={`${free.officeName}, ${free.roomName}`}
                onClick={() => props.onPick(free)}
              >
                {free.time}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
