import {
  CalendarCheckIcon,
  CalendarClockIcon,
  CalendarXIcon,
  PencilIcon,
  UserXIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent } from "#/components/ui/card.tsx";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "#/components/ui/trace.tsx";
import { appointmentStatusLabels, cancellationText } from "#/lib/appointment-statuses.ts";
import type { AppointmentStatus } from "#/lib/appointments.ts";
import { assistantUserId } from "#/lib/audit-fields.ts";
import { formatDateTime } from "#/lib/dates.ts";
import { practiceTimeZone } from "#/lib/dates.ts";
import { historyChanges, historyTitle } from "#/lib/patients.ts";
import type { PatientAppointment } from "#/organization/appointments.ts";
import type { HistoryEntry } from "#/organization/patient-history.ts";

// A patient's `Actividad` tab, as `Trace` lines that open on their detail:
// `Turnos`, the upcoming ones soonest first, the past ones collapsed under
// them; and, for an admin, `Historial`, the changes to their data, collapsed.

interface Appointments {
  upcoming: PatientAppointment[];
  past: PatientAppointment[];
}

interface History {
  entries: HistoryEntry[];
  names: Record<string, string>;
}

export function ActivityTab(props: { appointments: Appointments | null; history: History | null }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-6">
        {props.appointments && <AppointmentsSection appointments={props.appointments} />}
        {props.history && <HistorySection history={props.history} />}
      </CardContent>
    </Card>
  );
}

function AppointmentsSection({ appointments }: { appointments: Appointments }) {
  const { upcoming, past } = appointments;
  return (
    <Section title="Turnos">
      <Trace>
        {upcoming.length === 0 && <Empty>No tiene turnos próximos.</Empty>}
        {upcoming.map((one) => (
          <AppointmentLine key={one.id} appointment={one} />
        ))}
        {past.length > 0 && (
          <Collapsed label={countLabel(past.length, "turno anterior", "turnos anteriores")}>
            {past.map((one) => (
              <AppointmentLine key={one.id} appointment={one} />
            ))}
          </Collapsed>
        )}
      </Trace>
    </Section>
  );
}

function HistorySection({ history }: { history: History }) {
  const { entries, names } = history;
  return (
    <Section title="Historial">
      <Trace>
        <Collapsed label={countLabel(entries.length, "cambio", "cambios")}>
          {entries.map((entry) => (
            <ChangeLine key={entry.id} entry={entry} names={names} />
          ))}
        </Collapsed>
      </Trace>
    </Section>
  );
}

const countLabel = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

function Section(props: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{props.title}</h3>
      {props.children}
    </div>
  );
}

const Empty = (props: { children: ReactNode }) => (
  <p className="text-muted-foreground text-sm">{props.children}</p>
);

/** Lines hidden behind one that says how many, closed until opened. */
function Collapsed(props: { label: string; children: ReactNode }) {
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine>
          <TraceTitle>{props.label}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Trace>{props.children}</Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

const statusIcons: Partial<Record<AppointmentStatus, LucideIcon>> = {
  noShow: UserXIcon,
  cancelled: CalendarXIcon,
  attended: CalendarCheckIcon,
};

/** An appointment: with whom and what, when and its status; it opens on where, and why it was cancelled. */
function AppointmentLine({ appointment }: { appointment: PatientAppointment }) {
  const Icon = statusIcons[appointment.status] ?? CalendarClockIcon;
  const details = [
    appointment.roomName,
    appointment.overbooking ? "Sobreturno" : null,
    cancellationText(appointment),
  ].filter(Boolean);
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status={appointment.status === "noShow" ? "error" : undefined}>
          <TraceIcon>
            <Icon />
          </TraceIcon>
          <TraceTitle>
            {appointment.practitionerName} · {appointment.medicalServiceName}
          </TraceTitle>
          <TraceDescription>
            {formatDateTime(appointment.start, practiceTimeZone)} ·{" "}
            {appointmentStatusLabels[appointment.status]}
          </TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        {details.map((detail) => (
          <p key={detail} className="text-sm">
            {detail}
          </p>
        ))}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/** Who made an entry's change: a member, the assistant on a patient's yes, or a member since removed. */
function authorOf(entry: HistoryEntry) {
  if (entry.userId === assistantUserId) {
    return "Asistente";
  }
  return entry.userName ?? "Usuario eliminado";
}

/** A change to the patient's data: what, when and who; it opens on each field's before and after. */
function ChangeLine(props: { entry: HistoryEntry; names: Record<string, string> }) {
  const { entry } = props;
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine>
          <TraceIcon>
            <PencilIcon />
          </TraceIcon>
          <TraceTitle>{historyTitle(entry)}</TraceTitle>
          <TraceDescription>
            {formatDateTime(entry.createdAt, practiceTimeZone)} · {authorOf(entry)}
          </TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <ul className="text-sm">
          {historyChanges(entry, props.names).map((change) => (
            <li key={change.field}>
              {change.field}: {change.before} → {change.after}
            </li>
          ))}
        </ul>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
