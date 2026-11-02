import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { ErrorAlert, RefusalMessage, useFormAction } from "#/components/admin-form.tsx";
import { DeactivateButton } from "#/components/confirm-dialog.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Detail, RecordSection } from "#/components/record-section.tsx";
import { patientRefusalMessages } from "#/components/patient-save.ts";
import { CoverageList } from "#/components/patient-coverages.tsx";
import {
  GuardianList,
  MessageContactChoice,
  MinorPrompt,
} from "#/components/patient-guardians.tsx";
import { patientSearchQueries } from "#/components/patient-search.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { defaultTimeZone } from "#/lib/offices.ts";
import {
  documentLabel,
  historyChanges,
  legalName,
  patientBadges,
  patientName,
} from "#/lib/patients.ts";
import { formatPhone } from "#/lib/phones.ts";
import { formatLocalDate } from "#/lib/schedules.ts";
import { appointmentStatusLabels, cancellationText } from "#/lib/appointment-statuses.ts";
import { getPatientAppointments } from "#/server/appointments.functions.ts";
import { getCoverages } from "#/server/coverages.functions.ts";
import { getGuardians } from "#/server/guardians.functions.ts";
import type { Guardian } from "#/server/guardians.ts";
import {
  changePatientActive,
  changeWhatsappConsent,
  getPatientChanges,
  getPatientDetails,
  getPatientUpcomingCount,
} from "#/server/patients.functions.ts";
import type { PatientAppointment } from "#/server/patient-appointments.ts";
import type { HistoryEntry, Patient } from "#/server/patients.ts";

export const Route = createFileRoute("/_app/pacientes/$patientId")({
  loader: async ({ params, context }) => {
    const data = { patientId: params.patientId };
    const [details, coverages, guardians, history, appointments] = await Promise.all([
      getPatientDetails({ data }),
      getCoverages({ data }),
      getGuardians({ data }),
      context.viewer.roles.includes("admin") ? getPatientChanges({ data }) : null,
      getPatientAppointments({ data }),
    ]);
    return { details, coverages, guardians, history, appointments };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.details.ok
          ? `${patientName(loaderData.details.patient)} · Rubens`
          : "Pacientes · Rubens",
      },
    ],
  }),
  component: PatientScreen,
});

function useAction() {
  return useFormAction(patientRefusalMessages);
}

// Instants are shown in the organization's zone; offices are all in Argentina.
const instantFormat = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  hourCycle: "h23",
  timeZone: defaultTimeZone,
});

function PatientScreen() {
  const { viewer } = Route.useRouteContext();
  const { details, coverages, guardians, history, appointments } = Route.useLoaderData();

  if (!details.ok) {
    return <RefusalMessage message={patientRefusalMessages[details.reason]} />;
  }
  const { patient } = details;

  // Keyed by patient: a link to another patient stays on this route, and must
  // not carry one patient's messages over.
  return (
    <div key={patient.id} className="mx-auto flex max-w-3xl flex-col gap-6">
      <PatientHeading patient={patient} isAdmin={viewer.roles.includes("admin")} />
      <DetailsSection patient={patient} />
      <CoverageSection patientId={patient.id} coverages={coverages} />
      <GuardianSection patient={patient} guardians={guardians} />
      <WhatsappSection patient={patient} />
      <AppointmentsSection appointments={appointments} />
      {history?.ok && <HistorySection entries={history.entries} names={history.names} />}
    </div>
  );
}

function PatientHeading({ patient, isAdmin }: { patient: Patient; isAdmin: boolean }) {
  return (
    <PageHeader
      back={{ to: "/pacientes", label: "Pacientes" }}
      title={patientName(patient)}
      status={!patient.active && <Badge variant="secondary">Inactivo</Badge>}
      description={<PatientBadges patient={patient} />}
      actions={isAdmin && <ActiveToggle patient={patient} />}
    />
  );
}

function PatientBadges({ patient }: { patient: Patient }) {
  const badges = patientBadges(patient);
  if (badges.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {badges.map((badge) => (
        <Badge key={badge.label} variant={badge.variant}>
          {badge.label}
        </Badge>
      ))}
    </div>
  );
}

/** The admin's deactivate or reactivate button. */
function ActiveToggle({ patient }: { patient: Patient }) {
  const toggle = useAction();
  const queryClient = useQueryClient();

  async function changeActive(active: boolean) {
    const changed = await toggle.run(() =>
      changePatientActive({ data: { id: patient.id, active } }),
    );
    if (changed) {
      // A search cached before the change would still list the patient as they were.
      await queryClient.invalidateQueries({ queryKey: patientSearchQueries });
    }
  }

  return (
    <div className="flex flex-col items-end gap-3">
      {patient.active ? (
        <DeactivateButton
          key={patient.id}
          question={`¿Desactivar a ${patientName(patient)}?`}
          pending={toggle.pending}
          countUpcoming={() => getPatientUpcomingCount({ data: { id: patient.id } })}
          onDeactivate={() => void changeActive(false)}
        />
      ) : (
        <Button variant="outline" disabled={toggle.pending} onClick={() => void changeActive(true)}>
          Reactivar
        </Button>
      )}
      <ErrorAlert message={toggle.error} />
    </div>
  );
}

function DetailsSection({ patient }: { patient: Patient }) {
  return (
    <RecordSection
      title="Datos"
      action={
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link to="/pacientes/$patientId/editar" params={{ patientId: patient.id }} />}
        >
          Editar
        </Button>
      }
    >
      <dl className="grid gap-4 sm:grid-cols-2">
        <Detail label="Nombre legal" value={legalName(patient)} />
        <Detail label="Nombre autopercibido" value={patient.chosenName} />
        <Detail label="Documento" value={documentLabel(patient)} />
        <Detail
          label="Fecha de nacimiento"
          value={patient.birthDate && formatLocalDate(patient.birthDate)}
        />
        <Detail label="Teléfono" value={formatPhone(patient.phone)} />
        <Detail label="Correo electrónico" value={patient.email} />
        <Detail label="Dirección" value={patient.address} />
      </dl>
    </RecordSection>
  );
}

type LoaderData = ReturnType<typeof Route.useLoaderData>;

/** The coverages section, left out when the list was refused. */
function CoverageSection(props: { patientId: string; coverages: LoaderData["coverages"] }) {
  const { patientId } = props;
  if (!props.coverages.ok) {
    return null;
  }
  return (
    <RecordSection
      title="Coberturas"
      action={
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link to="/pacientes/$patientId/coberturas/nueva" params={{ patientId }} />}
        >
          Agregar cobertura
        </Button>
      }
    >
      <CoverageList patientId={patientId} coverages={props.coverages.coverages} />
    </RecordSection>
  );
}

/** The guardians section, left out when the list was refused. */
function GuardianSection(props: { patient: Patient; guardians: LoaderData["guardians"] }) {
  if (!props.guardians.ok) {
    return null;
  }
  return <GuardianCard patient={props.patient} guardians={props.guardians.guardians} />;
}

function GuardianCard(props: { patient: Patient; guardians: Guardian[] }) {
  const patientId = props.patient.id;
  return (
    <RecordSection
      title="Responsables"
      action={
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link to="/pacientes/$patientId/responsables/nuevo" params={{ patientId }} />}
        >
          Agregar responsable
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        <MinorPrompt patient={props.patient} guardians={props.guardians} />
        <GuardianList patientId={patientId} guardians={props.guardians} />
        <MessageContactChoice patient={props.patient} guardians={props.guardians} />
      </div>
    </RecordSection>
  );
}

function WhatsappSection({ patient }: { patient: Patient }) {
  const action = useAction();
  const consent = !patient.whatsappConsent;
  return (
    <RecordSection title="WhatsApp">
      <div className="flex flex-col gap-4">
        <ErrorAlert message={action.error} />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p>
            {patient.whatsappConsent
              ? `Acepta WhatsApp desde el ${instantFormat.format(patient.whatsappConsentAt)}.`
              : "No acepta WhatsApp: no se le envían mensajes."}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={action.pending}
            onClick={() =>
              void action.run(() =>
                changeWhatsappConsent({
                  data: { patientId: patient.id, whatsappConsent: consent },
                }),
              )
            }
          >
            {consent ? "Volver a aceptar WhatsApp" : "Dejar de enviar por WhatsApp"}
          </Button>
        </div>
      </div>
    </RecordSection>
  );
}

/** The patient's appointments, upcoming then past, with their statuses. */
function AppointmentsSection({ appointments }: { appointments: LoaderData["appointments"] }) {
  if (!appointments.ok) {
    return null;
  }
  return (
    <RecordSection title="Turnos">
      <div className="flex flex-col gap-6">
        <AppointmentList
          title="Próximos"
          appointments={appointments.upcoming}
          empty="No tiene turnos próximos."
        />
        <AppointmentList
          title="Anteriores"
          appointments={appointments.past}
          empty="No tiene turnos anteriores."
        />
      </div>
    </RecordSection>
  );
}

function AppointmentList(props: {
  title: string;
  appointments: PatientAppointment[];
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{props.title}</h3>
      {props.appointments.length === 0 ? (
        <p className="text-muted-foreground text-sm">{props.empty}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {props.appointments.map((appointment) => (
            <AppointmentItem key={appointment.id} appointment={appointment} />
          ))}
        </ol>
      )}
    </div>
  );
}

function AppointmentItem({ appointment }: { appointment: PatientAppointment }) {
  const when = new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
    hourCycle: "h23",
    timeZone: appointment.timeZone,
  });
  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-col gap-0.5 text-sm">
        <p>
          <span className="font-medium">{when.format(appointment.start)}</span> ·{" "}
          {appointment.practitionerName} · {appointment.medicalServiceName}
        </p>
        <p className="text-muted-foreground">
          {[`${appointment.officeName}, ${appointment.roomName}`, cancellationText(appointment)]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div className="flex gap-1">
        {appointment.overbooking && <Badge variant="outline">Sobreturno</Badge>}
        <Badge variant={appointment.status === "noShow" ? "destructive" : "secondary"}>
          {appointmentStatusLabels[appointment.status]}
        </Badge>
      </div>
    </li>
  );
}

const actionLabels: Record<HistoryEntry["action"], string> = {
  create: "Alta",
  update: "Cambio",
  delete: "Baja",
  deactivate: "Desactivación",
  reactivate: "Reactivación",
};

/** What an entry is about, after its action: nothing for the patient's own. */
const entityLabels: Record<string, string> = {
  appointment: " de turno",
  coverage: " de cobertura",
  guardian: " de responsable",
};

function HistorySection(props: { entries: HistoryEntry[]; names: Record<string, string> }) {
  const { entries, names } = props;
  return (
    <RecordSection title="Historial de cambios">
      <ol className="flex flex-col gap-4">
        {entries.map((entry) => (
          <li key={entry.id} className="flex flex-col gap-1">
            <p className="text-sm">
              <span className="font-medium">
                {actionLabels[entry.action]}
                {entityLabels[entry.entityType]}
              </span>
              <span className="text-muted-foreground">
                {" · "}
                {instantFormat.format(entry.createdAt)} · {entry.userName ?? "Usuario eliminado"}
              </span>
            </p>
            <ul className="text-muted-foreground text-sm">
              {historyChanges(entry, names).map((change) => (
                <li key={change.field}>
                  {change.field}: {change.before} → {change.after}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </RecordSection>
  );
}
