import { CircleDotIcon, UsersIcon } from "lucide-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import * as z from "zod";

import { DataTable, RowLink, useServerDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import type { FilterGroup } from "#/components/filter-groups.ts";
import { ErrorAlert, RefusalMessage } from "#/components/admin-form.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { PatientRegistrationForm } from "#/components/patient-form.tsx";
import { patientRefusalMessages } from "#/components/patient-save.ts";
import { patientSearchKey } from "#/components/patient-search.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { documentLabel, patientName, patientPageSize } from "#/lib/patients.ts";
import { formatPhone } from "#/lib/phones.ts";
import { findPatients, getPatients } from "#/server/patients.functions.ts";
import type { ListedPatient, Patient, PatientPage } from "#/server/patients.ts";

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

type Found = Awaited<ReturnType<typeof findPatients>>;

/**
 * The patients matching what is typed. Each query is its own request; the
 * answer is the one for the current text, never a slower one to an earlier text.
 */
function useFoundPatients(query: string, inactivos?: boolean): Found | undefined {
  const { viewer } = Route.useRouteContext();
  const searching = query.trim() !== "";
  const search = { query, includeInactive: inactivos ?? false };
  const { data } = useQuery({
    queryKey: patientSearchKey(viewer, search),
    queryFn: () => findPatients({ data: search }),
    placeholderData: keepPreviousData,
    enabled: searching,
  });
  return searching ? data : undefined;
}

/** The registry's page, until a search has an answer to show instead. */
function shownPatients(listed: PatientPage, found?: Found) {
  if (!found) {
    return listed.patients;
  }
  return found.ok ? found.patients : [];
}

function Registry({ listed }: { listed: PatientPage }) {
  const { inactivos } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [query, setQuery] = useState("");
  const found = useFoundPatients(query, inactivos);
  const table = useServerDataTable({
    rows: shownPatients(listed, found),
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Pacientes" />
      <RegisterPanel />
      <DataTable
        table={table}
        search={{
          value: query,
          onChange: setQuery,
          label: "Buscar paciente",
          placeholder: "Buscar por nombre, documento o teléfono",
        }}
        filters={{
          groups: [statusFilter(inactivos)],
          onPick: (_id, value) =>
            void navigate({ search: { inactivos: value === "todos" ? true : undefined } }),
        }}
        pager={query.trim() ? undefined : pager}
        empty={<NoPatients found={found} inactivos={inactivos} />}
      />
    </div>
  );
}

function statusFilter(inactivos?: boolean): FilterGroup {
  return {
    id: "estado",
    label: "Estado",
    icon: CircleDotIcon,
    required: true,
    value: inactivos ? "todos" : "activos",
    options: [
      { value: "activos", label: "Activos" },
      { value: "todos", label: "Todos" },
    ],
  };
}

function NoPatients(props: { found?: Found; inactivos?: boolean }) {
  const { found, inactivos } = props;
  if (found && !found.ok) {
    return <ErrorAlert message={patientRefusalMessages[found.reason]} />;
  }
  if (found) {
    return (
      <EmptyState
        icon={UsersIcon}
        title="Ningún paciente coincide con la búsqueda"
        description={`Probá con otro nombre, documento o teléfono${inactiveHint(inactivos)}.`}
      />
    );
  }
  return (
    <EmptyState
      icon={UsersIcon}
      title="No hay pacientes para mostrar"
      description={`Agregá uno con Nuevo paciente${inactiveHint(inactivos)}.`}
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

function RegisterPanel() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const showPatient = (patient: Patient) =>
    void navigate({ to: "/pacientes/$patientId", params: { patientId: patient.id } });

  if (!open) {
    return (
      <div>
        <Button onClick={() => setOpen(true)}>Nuevo paciente</Button>
      </div>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Nuevo paciente</CardTitle>
      </CardHeader>
      <CardContent>
        <PatientRegistrationForm
          onCancel={() => setOpen(false)}
          onRegistered={showPatient}
          onUseExisting={showPatient}
        />
      </CardContent>
    </Card>
  );
}
