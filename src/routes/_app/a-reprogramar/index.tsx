import { CalendarSyncIcon } from "lucide-react";
import { tz } from "@date-fns/tz";
import { Link, createFileRoute } from "@tanstack/react-router";
import { cn } from "cn";
import { format } from "date-fns";

import { EmptyState } from "#/components/empty-state.tsx";
import { RefusalMessage } from "#/components/admin-form.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Button } from "#/components/ui/button.tsx";
import { practitionerColorClasses } from "#/lib/practitioner-colors.ts";
import { getToReschedule } from "#/server/appointments.functions.ts";
import type { ToRescheduleEntry, ToRescheduleReason } from "#/organization/to-reschedule.ts";

// The "to reschedule" list (ui: "Turnos a reprogramar"): future appointments
// that time off, a closure or a schedule change left outside working time, of
// someone deactivated or in a deactivated place, soonest first, for reception
// to call each patient.
// Each one opens the agenda's own pages to reschedule or cancel it; one of
// someone deactivated cannot take a new time until they are reactivated, and
// one in a deactivated place is told why free times may be missing.

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

const reasonLabels: Record<ToRescheduleReason, string> = {
  timeOff: "El profesional tiene una ausencia",
  closure: "La sede está cerrada",
  outsideSchedules: "Fuera de los horarios del profesional",
  practitionerInactive: "El profesional está desactivado",
  patientInactive: "El paciente está desactivado",
  officeInactive: "La sede está desactivada",
  roomInactive: "El consultorio está desactivado",
};

/** The reasons an appointment cannot take a new time yet. */
const blockedReasons: ToRescheduleReason[] = ["practitionerInactive", "patientInactive"];

/** What else an administrator can do for an appointment in a deactivated place. */
const placeRemedies: Partial<Record<ToRescheduleReason, string>> = {
  officeInactive: "reactivar la sede",
  roomInactive: "reactivar el consultorio",
};

function localDateTime(instant: Date, timeZone: string) {
  return format(instant, "dd/MM/yyyy HH:mm", { in: tz(timeZone) });
}

function ToRescheduleList() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Turnos a reprogramar" />
      {result.appointments.length === 0 ? (
        <EmptyState
          icon={CalendarSyncIcon}
          title="No hay turnos para reprogramar"
          description="No hace falta hacer nada. Acá aparecen los turnos que hay que mover o cancelar."
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {result.appointments.map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Why the entry cannot move yet, or what else would bring free times back. */
function entryNote(reason: ToRescheduleReason): string | null {
  if (blockedReasons.includes(reason)) {
    return "No se puede reprogramar hasta que un administrador lo reactive.";
  }
  const placeRemedy = placeRemedies[reason];
  return placeRemedy
    ? `Solo hay horarios libres en consultorios activos. Si no aparece ninguno, un administrador puede ${placeRemedy} o cargarle otro horario al profesional.`
    : null;
}

function EntryRow({ entry }: { entry: ToRescheduleEntry }) {
  const params = { appointmentId: entry.id };
  const note = entryNote(entry.reason);
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
        {note && <p className="text-muted-foreground">{note}</p>}
      </div>
      <div className="flex gap-2">
        {!blockedReasons.includes(entry.reason) && (
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link to="/agenda/turnos/$appointmentId/reprogramar" params={params} />}
          >
            Reprogramar
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link to="/agenda/turnos/$appointmentId/cancelar" params={params} />}
        >
          Cancelar
        </Button>
      </div>
    </li>
  );
}
