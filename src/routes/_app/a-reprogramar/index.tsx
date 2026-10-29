import { tz } from "@date-fns/tz";
import { createFileRoute } from "@tanstack/react-router";
import { cn } from "cn";
import { format } from "date-fns";
import { useState } from "react";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog.tsx";
import { practitionerColorClasses } from "#/lib/practitioner-colors.ts";
import type { OutsideWorkingTime } from "#/lib/availability.ts";
import { getToReschedule } from "#/server/appointments.functions.ts";
import type { ToRescheduleEntry } from "#/server/to-reschedule.ts";

import { CancelForm } from "#/routes/_app/agenda/-appointment-status.tsx";
import { RescheduleForm } from "#/routes/_app/agenda/-reschedule.tsx";

// The "to reschedule" list (ui: "Turnos a reprogramar"): future appointments
// that time off, a closure or a schedule change left outside working time,
// soonest first, for reception to call each patient. Each one is rescheduled
// or cancelled from here, with the agenda's own forms.

export const Route = createFileRoute("/_app/a-reprogramar/")({
  head: () => ({ meta: [{ title: "Turnos a reprogramar · Rubens" }] }),
  loader: () => getToReschedule(),
  component: ToRescheduleList,
});

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden:
    "Solo recepción, un administrador o un profesional pueden ver los turnos a reprogramar.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
};

const reasonLabels: Record<OutsideWorkingTime, string> = {
  timeOff: "El profesional tiene una ausencia",
  closure: "La sede está cerrada",
  outsideSchedules: "Fuera de los horarios del profesional",
};

/** The entry being acted on, and whether to reschedule or cancel it. */
interface Picked {
  entry: ToRescheduleEntry;
  action: "reschedule" | "cancel";
}

function localDateTime(instant: Date, timeZone: string) {
  return format(instant, "dd/MM/yyyy HH:mm", { in: tz(timeZone) });
}

function ToRescheduleList() {
  const result = Route.useLoaderData();
  const [picked, setPicked] = useState<Picked | null>(null);

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Turnos a reprogramar</h1>
      {result.appointments.length === 0 ? (
        <p className="text-muted-foreground">No hay turnos para reprogramar.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {result.appointments.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              onPick={(action) => setPicked({ entry, action })}
            />
          ))}
        </ul>
      )}
      <EntryDialog picked={picked} onClose={() => setPicked(null)} />
    </div>
  );
}

function EntryRow(props: { entry: ToRescheduleEntry; onPick: (action: Picked["action"]) => void }) {
  const { entry } = props;
  return (
    <li className="flex flex-wrap items-center gap-4 p-4">
      <div
        className={cn("h-10 w-1 shrink-0 rounded-full", practitionerColorClasses[entry.color])}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
        <p className="font-medium">
          {localDateTime(entry.start, entry.timeZone)} · {entry.patientName}
        </p>
        <p className="text-muted-foreground">
          {entry.practitioner.displayName} · {entry.medicalServiceName} · {entry.officeName},{" "}
          {entry.roomName}
        </p>
        <p className="text-muted-foreground">{reasonLabels[entry.reason]}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => props.onPick("reschedule")}>
          Reprogramar
        </Button>
        <Button variant="outline" size="sm" onClick={() => props.onPick("cancel")}>
          Cancelar
        </Button>
      </div>
    </li>
  );
}

function EntryDialog(props: { picked: Picked | null; onClose: () => void }) {
  const { picked } = props;
  return (
    <Dialog open={picked !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-svh overflow-y-auto sm:max-w-md">
        {picked && (
          <>
            <DialogHeader>
              <DialogTitle>{picked.entry.patientName}</DialogTitle>
              <DialogDescription>
                {localDateTime(picked.entry.start, picked.entry.timeZone)} con{" "}
                {picked.entry.practitioner.displayName} · {picked.entry.medicalServiceName}
              </DialogDescription>
            </DialogHeader>
            {picked.action === "reschedule" ? (
              <RescheduleForm
                key={picked.entry.id}
                appointment={picked.entry}
                practitionerId={picked.entry.practitioner.id}
                timeZone={picked.entry.timeZone}
                onDone={props.onClose}
                onBack={props.onClose}
              />
            ) : (
              <CancelForm
                key={picked.entry.id}
                appointmentId={picked.entry.id}
                onDone={props.onClose}
                onBack={props.onClose}
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
