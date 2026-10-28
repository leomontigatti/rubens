import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import * as z from "zod";

import { ErrorAlert, RefusalMessage } from "#/components/admin-form.tsx";
import { PatientRegistrationForm } from "#/components/patient-form.tsx";
import { patientRefusalMessages } from "#/components/patient-save.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { patientName } from "#/lib/patients.ts";
import { formatPhone } from "#/lib/phones.ts";
import { findPatients, getPatients } from "#/server/patients.functions.ts";
import type { Patient } from "#/server/patients.ts";

export const Route = createFileRoute("/_app/pacientes/")({
  head: () => ({ meta: [{ title: "Pacientes · Rubens" }] }),
  // The search text stays out of the address: a URL ends up in proxy logs and
  // the browser's history, and patient data must not.
  validateSearch: z.object({ inactivos: z.boolean().optional() }),
  loaderDeps: ({ search }) => ({ includeInactive: search.inactivos ?? false }),
  loader: ({ deps }) => getPatients({ data: deps }),
  component: Patients,
});

function Patients() {
  const result = Route.useLoaderData();
  const [query, setQuery] = useState("");

  if (!result.ok) {
    return <RefusalMessage message={patientRefusalMessages[result.reason]} />;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Pacientes</h1>
        <ShowInactivePatients />
      </div>
      <RegisterPanel />
      <Input
        type="search"
        aria-label="Buscar paciente"
        placeholder="Buscar por nombre, documento o teléfono"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query.trim() ? (
        <SearchResults query={query} />
      ) : (
        <PatientList patients={result.patients} emptyMessage="Todavía no hay pacientes." />
      )}
    </div>
  );
}

function ShowInactivePatients() {
  const { inactivos } = Route.useSearch();
  return (
    <Button
      variant="outline"
      nativeButton={false}
      render={
        <Link
          to="/pacientes"
          search={(previous) => ({ ...previous, inactivos: inactivos ? undefined : true })}
        />
      }
    >
      {inactivos ? "Ocultar inactivos" : "Mostrar inactivos"}
    </Button>
  );
}

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

/**
 * The patients matching `query`, asked for as the user types. Each query is
 * its own request; the list shows the one for the current text, never a slower
 * answer to an earlier one.
 */
function SearchResults({ query }: { query: string }) {
  const { inactivos } = Route.useSearch();
  const search = { query, includeInactive: inactivos ?? false };
  const { data } = useQuery({
    queryKey: ["patients", "search", search],
    queryFn: () => findPatients({ data: search }),
    placeholderData: keepPreviousData,
  });

  if (!data) {
    return null;
  }
  if (!data.ok) {
    return <ErrorAlert message={patientRefusalMessages[data.reason]} />;
  }
  return (
    <PatientList
      patients={data.patients}
      emptyMessage="Ningún paciente coincide con la búsqueda."
    />
  );
}

function PatientList({ patients, emptyMessage }: { patients: Patient[]; emptyMessage: string }) {
  if (patients.length === 0) {
    return <p className="text-muted-foreground">{emptyMessage}</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {patients.map((patient) => (
        <li key={patient.id}>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <Link
                  to="/pacientes/$patientId"
                  params={{ patientId: patient.id }}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {patientName(patient)}
                </Link>
                <span className="text-muted-foreground text-sm">
                  {formatPhone(patient.phone)}
                  {!patient.active && " · Inactivo"}
                </span>
              </div>
              {patient.incomplete && <Badge variant="outline">Datos incompletos</Badge>}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
