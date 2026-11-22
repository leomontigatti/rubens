import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";
import * as z from "zod";

import {
  ActionsMenu,
  activeRecord,
  ArchivedAlert,
  RefusalMessage,
} from "#/components/admin-form.tsx";
import { PageCrumbs } from "#/components/app-breadcrumbs.tsx";
import { fieldProblems } from "#/components/form-problems.ts";
import type { FieldProblem } from "#/components/form-problems.ts";
import { FormPage, useFormPage } from "#/components/form-page.tsx";
import type { RecordHeader } from "#/components/form-page.tsx";
import {
  contactFields,
  IncompleteAlert,
  PatientFields,
  useBirthDateMissing,
  PatientSaveFeedback,
  patientMessage,
  patientRefusals,
  usePatientForm,
  usePatientSave,
} from "#/components/patient-form.tsx";
import type { PatientFieldTab } from "#/components/patient-form.tsx";
import { patientRefusalMessages } from "#/components/patient-save.ts";
import { CoverageList } from "#/components/patient-coverages.tsx";
import {
  GuardianList,
  MessageContactChoice,
  MinorPrompt,
} from "#/components/patient-guardians.tsx";
import { patientSearchQueries } from "#/components/patient-search.ts";
import { Badge } from "#/components/ui/badge.tsx";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "#/components/ui/dropdown-menu.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs.tsx";
import { useRevealProblem } from "#/hooks/use-reveal-problem.ts";
import { patientBadges, patientName, patientUpdateSchema } from "#/lib/patients.ts";
import type { DuplicateConfirmation, PatientUpdate } from "#/lib/patients.ts";
import { getPatientAppointments } from "#/server/appointments.functions.ts";
import { getCoverages } from "#/server/coverages.functions.ts";
import { getGuardians } from "#/server/guardians.functions.ts";
import type { Coverage } from "#/organization/coverages.ts";
import type { Guardian } from "#/organization/guardians.ts";
import {
  changePatientActive,
  editPatient,
  getPatientChanges,
  getPatientDetails,
  getPatientUpcomingCount,
} from "#/server/patients.functions.ts";
import type { Patient } from "#/organization/patients.ts";

import { ActivityTab } from "#/routes/_app/pacientes/-patient-activity.tsx";
import {
  ConversationButton,
  useWhatsappConsent,
  WhatsappAlert,
  WhatsappMenuItem,
} from "#/routes/_app/pacientes/-patient-whatsapp.tsx";

/**
 * The page's tabs: the patient's own data, in two, then what hangs off them;
 * `Coberturas` and `Responsables` only once there is one (`Acciones` adds the
 * first).
 */
const sections = ["datos", "contacto", "coberturas", "responsables", "actividad"] as const;
type Section = (typeof sections)[number];

export const Route = createFileRoute("/_app/pacientes/$patientId")({
  validateSearch: z.object({
    seccion: z.enum(sections).optional().catch(undefined),
  }),
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
          ? `${patientName(loaderData.details.patient)} · underthing`
          : "Pacientes · underthing",
      },
    ],
  }),
  staticData: { crumbs: Crumbs },
  component: PatientScreen,
});

function PatientScreen() {
  const { details } = Route.useLoaderData();
  if (!details.ok) {
    return <RefusalMessage message={patientRefusalMessages[details.reason]} />;
  }
  // Keyed by patient: a link to another patient stays on this route, and must
  // not carry one patient's form or messages over.
  return <PatientPage key={details.patient.id} patient={details.patient} />;
}

/**
 * The patient's page, which is their edit form: titled by their name with
 * their states, `Acciones` beside it, and tabs for the form and what hangs off
 * the patient. Every member edits a patient; only an admin deactivates one.
 */
function PatientPage({ patient }: { patient: Patient }) {
  const { viewer } = Route.useRouteContext();
  const loaded = Route.useLoaderData();
  const page = useFormPage({ to: "/pacientes" });
  const { save, form } = usePatientEdit(patient, page);
  const consent = useWhatsappConsent(patient.id);
  const record = usePatientRecord(patient, viewer.roles.includes("admin"), consent);
  const lists = {
    coverages: loaded.coverages.ok ? loaded.coverages.coverages : [],
    guardians: loaded.guardians.ok ? loaded.guardians.guardians : [],
  };
  const tabs = usePatientTabs(lists);
  const details = loaded.details.ok ? loaded.details : null;
  useProblemTab(page, patientRefusals(save), tabs.setSection);

  return (
    <FormPage
      page={page}
      form={form}
      title={patientName(patient)}
      description="Los datos del paciente, cómo contactarlo, sus coberturas, responsables y actividad."
      submitLabel="Guardar"
      pending={save.pending}
      refusals={patientRefusals(save)}
      onClear={save.dismiss}
      record={record}
      alerts={
        <PatientAlerts
          patient={patient}
          form={form}
          consent={consent}
          guardians={loaded.guardians.ok ? loaded.guardians.guardians : null}
          optOutPendingSince={details?.optOutPendingSince ?? null}
        />
      }
      frame={(content) => (
        <PatientTabs patient={patient} tabs={tabs} lists={lists} activity={loaded}>
          {content}
        </PatientTabs>
      )}
    >
      <PatientSaveFeedback
        save={save}
        confirmLabel="Guardar igual"
        onUse={(other) =>
          page.leave({ to: "/pacientes/$patientId", params: { patientId: other.id } })
        }
      />
      <PatientFields
        form={form}
        full
        tab={tabs.formTab}
        phoneAction={
          details?.conversationId && <ConversationButton conversationId={details.conversationId} />
        }
      />
    </FormPage>
  );
}

/** The patient's form, and its save, which goes back to the list once done. */
function usePatientEdit(patient: Patient, page: ReturnType<typeof useFormPage>) {
  const save = usePatientSave(
    (data: PatientUpdate & DuplicateConfirmation) => editPatient({ data }),
    () => page.leave(),
  );
  const form = usePatientForm(patient, async (input) => {
    const update = { ...input, patientId: patient.id };
    const parsed = patientUpdateSchema.safeParse(update);
    if (!parsed.success) {
      page.showProblems(fieldProblems(parsed.error.issues, patientMessage));
      return;
    }
    await save.submit(update);
  });
  return { save, form };
}

interface PatientLists {
  coverages: Coverage[];
  guardians: Guardian[];
}

/**
 * The open tab. The URL picks the one a page opens on (a coverage's or
 * guardian's pages come back to theirs); a click switches it here, since a
 * navigation would ask before discarding an unsaved edit. A tab gone, such as
 * `Coberturas` after the last one is removed, opens `Datos generales`.
 */
function usePatientTabs(lists: PatientLists) {
  const { seccion = "datos" } = Route.useSearch();
  const [chosen, setSection] = useState<Section>(seccion);
  const gone =
    (chosen === "coberturas" && lists.coverages.length === 0) ||
    (chosen === "responsables" && lists.guardians.length === 0);
  const section = gone ? "datos" : chosen;
  const formTab: PatientFieldTab = section === "contacto" ? "contacto" : "datos";
  return { section, setSection, formTab };
}

/** The alerts above the form: missing data, a minor's guardian, the WhatsApp. */
function PatientAlerts(props: {
  patient: Patient;
  form: ReturnType<typeof usePatientForm>;
  consent: ReturnType<typeof useWhatsappConsent>;
  guardians: Guardian[] | null;
  optOutPendingSince: number | null;
}) {
  const { patient, consent } = props;
  const birthDateMissing = useBirthDateMissing(props.form);
  return (
    <>
      {birthDateMissing && <IncompleteAlert />}
      {props.guardians && <MinorPrompt patient={patient} guardians={props.guardians} />}
      <WhatsappAlert
        patient={patient}
        optOutPendingSince={props.optOutPendingSince}
        consent={consent}
      />
    </>
  );
}

/**
 * The tabs: the form, `children`, across `Datos generales` and `Contacto`;
 * `Coberturas` and `Responsables` once there is one; `Actividad`.
 */
function PatientTabs(props: {
  patient: Patient;
  tabs: ReturnType<typeof usePatientTabs>;
  lists: PatientLists;
  activity: {
    appointments: Awaited<ReturnType<typeof getPatientAppointments>>;
    history: Awaited<ReturnType<typeof getPatientChanges>> | null;
  };
  children: ReactNode;
}) {
  const { patient, tabs, lists } = props;
  const { appointments, history } = props.activity;
  return (
    <Tabs value={tabs.section} onValueChange={(value: Section) => tabs.setSection(value)}>
      <TabsList className="w-full">
        <TabsTrigger value="datos">Datos generales</TabsTrigger>
        <TabsTrigger value="contacto">Contacto</TabsTrigger>
        <CountedTab value="coberturas" label="Coberturas" count={lists.coverages.length} />
        <CountedTab value="responsables" label="Responsables" count={lists.guardians.length} />
        <TabsTrigger value="actividad">Actividad</TabsTrigger>
      </TabsList>
      {/* One form across both tabs: its panel follows the tab it shows. */}
      <TabsContent value={tabs.formTab} keepMounted>
        {props.children}
      </TabsContent>
      <TabsContent value="coberturas">
        <CoverageList patientId={patient.id} coverages={lists.coverages} />
      </TabsContent>
      <TabsContent value="responsables">
        <GuardiansTab patient={patient} guardians={lists.guardians} />
      </TabsContent>
      <TabsContent value="actividad">
        <ActivityTab
          appointments={appointments.ok ? appointments : null}
          history={history?.ok ? history : null}
        />
      </TabsContent>
    </Tabs>
  );
}

/** A tab with its count, shown only once there is one. */
function CountedTab(props: { value: Section; label: string; count: number }) {
  if (props.count === 0) {
    return null;
  }
  return (
    <TabsTrigger value={props.value}>
      {props.label}
      <Badge variant="outline">{props.count}</Badge>
    </TabsTrigger>
  );
}

const tabOfField = (field: string): Section => (contactFields.has(field) ? "contacto" : "datos");

/**
 * A refusal for a field the open tab does not show opens the tab that does,
 * and focuses the field there.
 */
function useProblemTab(
  page: ReturnType<typeof useFormPage>,
  refusals: FieldProblem[],
  setSection: (section: Section) => void,
) {
  const field = [...page.problems, ...refusals].find((one) => one.field)?.field;
  useRevealProblem(field, page.problemsShown, tabOfField, setSection);
}

/**
 * The patient's header: their state and what else to notice beside the name,
 * and `Acciones` with the creates for their coverages and guardians, then, for
 * an admin, the archive; and, while they are archived, the alert that says so,
 * with `Restaurar` for an admin only.
 */
function usePatientRecord(
  patient: Patient,
  isAdmin: boolean,
  consent: ReturnType<typeof useWhatsappConsent>,
): RecordHeader {
  const toggle = consent.action;
  const queryClient = useQueryClient();
  const patientId = patient.id;
  const items = (
    <>
      <DropdownMenuItem
        render={<Link to="/pacientes/$patientId/coberturas/nueva" params={{ patientId }} />}
      >
        Agregar cobertura
      </DropdownMenuItem>
      <DropdownMenuItem
        render={<Link to="/pacientes/$patientId/responsables/nuevo" params={{ patientId }} />}
      >
        Agregar responsable
      </DropdownMenuItem>
    </>
  );

  async function changeActive(active: boolean) {
    const changed = await toggle.run(() =>
      changePatientActive({ data: { id: patientId, active } }),
    );
    if (changed) {
      // A search cached before the change would still list the patient as they were.
      await queryClient.invalidateQueries({ queryKey: patientSearchQueries });
    }
  }

  const record = activeRecord({
    active: patient.active,
    ending: "o",
    archived: archivedPatient,
    transitionId: patientId,
    toggle,
    onChange: (active) => void changeActive(active),
    deactivation: {
      question: `¿Archivar a ${patientName(patient)}?`,
      countUpcoming: () => getPatientUpcomingCount({ data: { id: patientId } }),
    },
    items,
    states: <WhatsappMenuItem patient={patient} consent={consent} />,
  });
  const status = (
    <>
      {record.status}
      <PatientBadges patient={patient} />
    </>
  );
  if (isAdmin) {
    return { ...record, status };
  }
  return {
    status,
    transitionId: patientId,
    actions: (busy) => (
      <ActionsMenu disabled={busy}>
        <DropdownMenuGroup>{items}</DropdownMenuGroup>
        <DropdownMenuSeparator />
        <WhatsappMenuItem patient={patient} consent={consent} />
      </ActionsMenu>
    ),
    error: toggle.error,
    alert: patient.active ? undefined : <ArchivedAlert notice={archivedPatient} ending="o" />,
  };
}

const archivedPatient = {
  title: "Paciente archivado",
  consequence: "No aparece en las listas ni se le pueden dar turnos.",
};

/** What else to notice about the patient, beside their state: missing data, a minor without a guardian. */
function PatientBadges({ patient }: { patient: Patient }) {
  return patientBadges(patient).map((badge) => (
    <Badge key={badge.label} variant={badge.variant}>
      {badge.label}
    </Badge>
  ));
}

function GuardiansTab(props: { patient: Patient; guardians: Guardian[] }) {
  return (
    <div className="flex flex-col gap-6">
      <GuardianList patientId={props.patient.id} guardians={props.guardians} />
      <MessageContactChoice patient={props.patient} guardians={props.guardians} />
    </div>
  );
}

function Crumbs() {
  const { details } = Route.useLoaderData();
  return <PageCrumbs items={[{ label: details.ok ? patientName(details.patient) : "Paciente" }]} />;
}
