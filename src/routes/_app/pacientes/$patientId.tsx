import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

import {
  ErrorAlert,
  FormActions,
  RefusalMessage,
  useFormAction,
} from "#/components/admin-form.tsx";
import {
  PatientFields,
  PatientSaveFeedback,
  patientFieldMessage,
  readPatientForm,
  usePatientSave,
} from "#/components/patient-form.tsx";
import { patientRefusalMessages } from "#/components/patient-save.ts";
import { CoverageList, NewCoverageForm } from "#/components/patient-coverages.tsx";
import {
  GuardianList,
  MessageContactChoice,
  MinorPrompt,
  NewGuardianForm,
} from "#/components/patient-guardians.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { defaultTimeZone } from "#/lib/offices.ts";
import {
  documentLabel,
  historyChanges,
  legalName,
  patientBadges,
  patientName,
  patientUpdateSchema,
} from "#/lib/patients.ts";
import { formatPhone } from "#/lib/phones.ts";
import { formatLocalDate } from "#/lib/schedules.ts";
import { getCoverages } from "#/server/coverages.functions.ts";
import type { Coverage } from "#/server/coverages.ts";
import { getGuardians } from "#/server/guardians.functions.ts";
import type { Guardian } from "#/server/guardians.ts";
import { getInsurers } from "#/server/insurers.functions.ts";
import type { Insurer } from "#/server/insurers.ts";
import {
  changePatientActive,
  changeWhatsappConsent,
  editPatient,
  getPatientChanges,
  getPatientDetails,
} from "#/server/patients.functions.ts";
import type { DuplicateConfirmation, PatientUpdate } from "#/lib/patients.ts";
import type { HistoryEntry, Patient } from "#/server/patients.ts";

export const Route = createFileRoute("/_app/pacientes/$patientId")({
  loader: async ({ params, context }) => {
    const data = { patientId: params.patientId };
    const [details, coverages, guardians, insurers, history] = await Promise.all([
      getPatientDetails({ data }),
      getCoverages({ data }),
      getGuardians({ data }),
      getInsurers({ data: { includeInactive: false } }),
      context.viewer.roles.includes("admin") ? getPatientChanges({ data }) : null,
    ]);
    return { details, coverages, guardians, insurers, history };
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
  const { details, coverages, guardians, insurers, history } = Route.useLoaderData();

  if (!details.ok) {
    return <RefusalMessage message={patientRefusalMessages[details.reason]} />;
  }
  const { patient } = details;

  // Keyed by patient: a link to another patient (from the duplicate warning)
  // stays on this route, and must not carry an open edit form over.
  return (
    <div key={patient.id} className="mx-auto flex max-w-3xl flex-col gap-6">
      <PatientHeading patient={patient} isAdmin={viewer.roles.includes("admin")} />
      <DetailsSection patient={patient} />
      <CoverageSection patientId={patient.id} coverages={coverages} insurers={insurers} />
      <GuardianSection patient={patient} guardians={guardians} />
      <WhatsappSection patient={patient} />
      {history?.ok && <HistorySection entries={history.entries} />}
    </div>
  );
}

function PatientHeading({ patient, isAdmin }: { patient: Patient; isAdmin: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-2">
        <Link
          to="/pacientes"
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
        >
          Pacientes
        </Link>
        <h1 className="text-2xl font-semibold">
          {patientName(patient)}
          {!patient.active && (
            <span className="text-muted-foreground font-normal"> · Inactivo</span>
          )}
        </h1>
        <PatientBadges patient={patient} />
      </div>
      {isAdmin && <ActiveToggle patient={patient} />}
    </div>
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
        <Badge key={badge} variant="outline">
          {badge}
        </Badge>
      ))}
    </div>
  );
}

/** The admin's deactivate or reactivate button. */
function ActiveToggle({ patient }: { patient: Patient }) {
  const toggle = useAction();
  return (
    <div className="flex flex-col items-end gap-3">
      <Button
        variant="outline"
        disabled={toggle.pending}
        onClick={() =>
          void toggle.run(() =>
            changePatientActive({ data: { id: patient.id, active: !patient.active } }),
          )
        }
      >
        {patient.active ? "Desactivar" : "Reactivar"}
      </Button>
      <ErrorAlert message={toggle.error} />
    </div>
  );
}

function Section(props: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        {props.action && <CardAction>{props.action}</CardAction>}
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  );
}

function Detail(props: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-sm">{props.label}</dt>
      <dd>{props.value ?? "—"}</dd>
    </div>
  );
}

function DetailsSection({ patient }: { patient: Patient }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <Section title="Datos">
        <PatientEditForm patient={patient} onDone={() => setEditing(false)} />
      </Section>
    );
  }

  return (
    <Section
      title="Datos"
      action={
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
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
    </Section>
  );
}

function PatientEditForm({ patient, onDone }: { patient: Patient; onDone: () => void }) {
  const navigate = useNavigate();
  const save = usePatientSave(
    (data: PatientUpdate & DuplicateConfirmation) => editPatient({ data }),
    onDone,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const update = { ...readPatientForm(new FormData(event.currentTarget)), patientId: patient.id };
    const parsed = patientUpdateSchema.safeParse(update);
    if (!parsed.success) {
      save.setError(patientFieldMessage(parsed.error));
      return;
    }
    await save.submit(update);
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <PatientSaveFeedback
        save={save}
        confirmLabel="Guardar igual"
        onUse={(other) =>
          void navigate({ to: "/pacientes/$patientId", params: { patientId: other.id } })
        }
      />
      <PatientFields idPrefix={patient.id} full initial={patient} />
      <FormActions pending={save.pending} submitLabel="Guardar" onCancel={onDone} />
    </form>
  );
}

type LoaderData = ReturnType<typeof Route.useLoaderData>;

/** The coverages section, left out when either list was refused. */
function CoverageSection(props: {
  patientId: string;
  coverages: LoaderData["coverages"];
  insurers: LoaderData["insurers"];
}) {
  if (!props.coverages.ok || !props.insurers.ok) {
    return null;
  }
  return (
    <CoverageCard
      patientId={props.patientId}
      coverages={props.coverages.coverages}
      insurers={props.insurers.insurers}
    />
  );
}

function CoverageCard(props: { patientId: string; coverages: Coverage[]; insurers: Insurer[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <Section
      title="Coberturas"
      action={
        !adding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            Agregar cobertura
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-6">
        {adding && (
          <NewCoverageForm
            patientId={props.patientId}
            insurers={props.insurers}
            onDone={() => setAdding(false)}
          />
        )}
        <CoverageList coverages={props.coverages} insurers={props.insurers} />
      </div>
    </Section>
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
  const [adding, setAdding] = useState(false);
  return (
    <Section
      title="Responsables"
      action={
        !adding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            Agregar responsable
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-6">
        <MinorPrompt patient={props.patient} guardians={props.guardians} />
        {adding && <NewGuardianForm patientId={props.patient.id} onDone={() => setAdding(false)} />}
        <GuardianList guardians={props.guardians} />
        <MessageContactChoice patient={props.patient} guardians={props.guardians} />
      </div>
    </Section>
  );
}

function WhatsappSection({ patient }: { patient: Patient }) {
  const action = useAction();
  const consent = !patient.whatsappConsent;
  return (
    <Section title="WhatsApp">
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
    </Section>
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
  coverage: " de cobertura",
  guardian: " de responsable",
};

function HistorySection({ entries }: { entries: HistoryEntry[] }) {
  return (
    <Section title="Historial de cambios">
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
              {historyChanges(entry).map((change) => (
                <li key={change.field}>
                  {change.field}: {change.before} → {change.after}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Section>
  );
}
