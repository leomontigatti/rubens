import { UsersIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import * as z from "zod";

import { DataTable, RowLink, useServerDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { showsAllPick, statusFilter } from "#/components/filter-groups.ts";
import { ErrorAlert, RefusalMessage } from "#/components/admin-form.tsx";
import { CreateButton } from "#/components/form-page.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { patientRefusalMessages } from "#/components/patient-save.ts";
import { patientSearchKey, patientSearchState } from "#/components/patient-search.ts";
import type { PatientSearchState } from "#/components/patient-search.ts";
import { useDebounced } from "#/components/use-debounced.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { documentLabel, patientName, patientPageSize } from "#/lib/patients.ts";
import { formatPhone } from "#/lib/phones.ts";
import { findPatients, getPatients } from "#/server/patients.functions.ts";
import type { ListedPatient, PatientPage } from "#/server/patients.ts";

export const Route = createFileRoute("/_app/pacientes/")({
  head: () => ({ meta: [{ title: "Pacientes · Rubens" }] }),
  // The search text stays out of the address: a URL ends up in proxy logs and
  // the browser's history, and patient data must not.
  validateSearch: z.object({
    inactivos: z.boolean().optional().catch(undefined),
    pagina: z.number().int().positive().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ includeInactive: search.inactivos ?? false, page: search.pagina }),
  loader: ({ deps }) => getPatients({ data: deps }),
  component: Patients,
});

function Patients() {
  const result = Route.useLoaderData();
  if (!result.ok) {
    return <RefusalMessage message={patientRefusalMessages[result.reason]} />;
  }
  return <Registry listed={result} />;
}

const inactiveHint = (shown?: boolean) => (shown ? "" : ", o mirá los inactivos");

const searchDelay = 300;

type PatientSearch = PatientSearchState<Awaited<ReturnType<typeof findPatients>>>;

/**
 * The patients matching what is typed, asked for once typing pauses. Each query
 * is its own request, and only the answer to the text in the box is shown.
 */
function usePatientSearch(typed: string, inactivos?: boolean): PatientSearch {
  const { viewer } = Route.useRouteContext();
  const asked = useDebounced(typed, searchDelay);
  const search = { query: asked.trim(), includeInactive: inactivos === true };
  const answer = useQuery({
    queryKey: patientSearchKey(viewer, search),
    queryFn: () => findPatients({ data: search }),
    enabled: search.query !== "",
  });
  return patientSearchState(typed, asked, answer);
}

/** The registry's page with no search; with one, only what it found. */
function shownPatients(listed: PatientPage, { searching, found }: PatientSearch) {
  if (!searching) {
    return listed.patients;
  }
  return found?.ok ? found.patients : [];
}

function searchProblem({ found, failed }: PatientSearch) {
  if (found && !found.ok) {
    return patientRefusalMessages[found.reason];
  }
  return failed ? "No pudimos buscar. Probá de nuevo." : null;
}

function Registry({ listed }: { listed: PatientPage }) {
  const { inactivos } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [query, setQuery] = useState("");
  const search = usePatientSearch(query, inactivos);
  const table = useServerDataTable({
    rows: shownPatients(listed, search),
    columns,
    getRowId: (patient) => patient.id,
  });
  const pager = {
    page: listed.page,
    pageCount: Math.ceil(listed.total / patientPageSize),
    total: listed.total,
    onPageChange: (pagina: number) =>
      void navigate({ search: (previous) => ({ ...previous, pagina }) }),
  };
  const changeStatus = (value: string | null) =>
    void navigate({ search: { inactivos: showsAllPick(value) } });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Pacientes" />
      <CreateButton can link={<Link to="/pacientes/nuevo" />}>
        Nuevo paciente
      </CreateButton>
      <DataTable
        table={table}
        search={{
          value: query,
          onChange: setQuery,
          label: "Buscar paciente",
          placeholder: "Buscar por nombre, documento o teléfono",
          loading: search.searching && !search.found && !search.failed,
        }}
        filters={{
          groups: [statusFilter(inactivos, { active: "Activos", all: "Todos" })],
          onPick: (_id, value) => changeStatus(value),
          onRemove: () => changeStatus(null),
        }}
        pager={search.searching ? undefined : pager}
        empty={<NoPatients search={search} inactivos={inactivos} />}
      />
    </div>
  );
}

function NoPatients(props: { search: PatientSearch; inactivos?: boolean }) {
  const { search, inactivos } = props;
  const problem = searchProblem(search);
  if (problem) {
    return <ErrorAlert message={problem} />;
  }
  if (!search.searching) {
    return (
      <EmptyState
        icon={UsersIcon}
        title="No hay pacientes para mostrar"
        description={`Agregá uno con Nuevo paciente${inactiveHint(inactivos)}.`}
      />
    );
  }
  if (!search.found) {
    return null;
  }
  return (
    <EmptyState
      icon={UsersIcon}
      title="Ningún paciente coincide con la búsqueda"
      description={`Probá con otro nombre, documento o teléfono${inactiveHint(inactivos)}.`}
    />
  );
}

const columns: DataTableColumn<ListedPatient>[] = [
  {
    id: "name",
    header: "Nombre",
    cell: (patient) => (
      <RowLink to="/pacientes/$patientId" params={{ patientId: patient.id }}>
        {patientName(patient)}
      </RowLink>
    ),
  },
  {
    id: "document",
    header: "Documento",
    cell: (patient) => documentLabel(patient) ?? "Sin documento",
  },
  { id: "phone", header: "Teléfono", cell: (patient) => formatPhone(patient.phone) },
  { id: "insurer", header: "Obra social", cell: (patient) => patient.insurerName ?? "Particular" },
  {
    id: "status",
    header: "Estado",
    cell: (patient) => (
      <div className="flex gap-2">
        {!patient.active && <Badge variant="secondary">Inactivo</Badge>}
        {patient.incomplete && <Badge variant="warning">Datos incompletos</Badge>}
      </div>
    ),
  },
];
