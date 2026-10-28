import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import * as z from "zod";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { PatientRegistrationForm, patientRefusalMessages } from "#/components/patient-form.tsx";
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
  validateSearch: z.object({ inactivos: z.boolean().optional(), q: z.string().optional() }),
  loaderDeps: ({ search }) => ({
    includeInactive: search.inactivos ?? false,
    query: search.q ?? "",
  }),
  // The whole list until something is typed in the search box.
  loader: ({ deps }) =>
    deps.query.trim()
      ? findPatients({ data: deps })
      : getPatients({ data: { includeInactive: deps.includeInactive } }),
  component: Patients,
});

function Patients() {
  const result = Route.useLoaderData();

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
      <SearchBox />
      <PatientList patients={result.patients} />
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

/** Results as the user types: each change replaces the query in the address. */
function SearchBox() {
  const { q } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [value, setValue] = useState(q ?? "");
  return (
    <Input
      type="search"
      aria-label="Buscar paciente"
      placeholder="Buscar por nombre, documento o teléfono"
      value={value}
      onChange={(event) => {
        const query = event.target.value;
        setValue(query);
        void navigate({
          search: (previous) => ({ ...previous, q: query || undefined }),
          replace: true,
        });
      }}
    />
  );
}

function PatientList({ patients }: { patients: Patient[] }) {
  const { q } = Route.useSearch();
  if (patients.length === 0) {
    return (
      <p className="text-muted-foreground">
        {q?.trim() ? "Ningún paciente coincide con la búsqueda." : "Todavía no hay pacientes."}
      </p>
    );
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
