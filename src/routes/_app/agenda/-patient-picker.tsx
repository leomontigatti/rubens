import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useState } from "react";

import { PatientRegistrationForm } from "#/components/patient-form.tsx";
import { patientSearchKey } from "#/components/patient-search.ts";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { patientName } from "#/lib/patients.ts";
import { findPatients } from "#/server/patients.functions.ts";
import type { Patient } from "#/server/patients.ts";

/** Finds the patient with the search box, or registers one on the spot. */
export function PatientPicker(props: { onChange: (patientId: string | null) => void }) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [registering, setRegistering] = useState(false);

  function choose(chosen: Patient | null) {
    setPatient(chosen);
    setRegistering(false);
    props.onChange(chosen?.id ?? null);
  }

  if (patient) {
    return (
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm">
          <span className="text-muted-foreground">Paciente:</span>{" "}
          <span className="font-medium">{patientName(patient)}</span>
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => choose(null)}>
          Cambiar
        </Button>
      </div>
    );
  }
  if (registering) {
    return (
      <PatientRegistrationForm
        onRegistered={choose}
        onUseExisting={choose}
        onCancel={() => setRegistering(false)}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <PatientSearch onChoose={choose} />
      <div>
        <Button type="button" variant="link" onClick={() => setRegistering(true)}>
          Registrar paciente nuevo
        </Button>
      </div>
    </div>
  );
}

function PatientSearch(props: { onChoose: (patient: Patient) => void }) {
  const { viewer } = useRouteContext({ from: "/_app" });
  const [query, setQuery] = useState("");
  const search = { query, includeInactive: false };
  const { data } = useQuery({
    queryKey: patientSearchKey(viewer, search),
    queryFn: () => findPatients({ data: search }),
    enabled: query.trim() !== "",
    placeholderData: keepPreviousData,
    select: (result) => (result.ok ? result.patients : []),
  });

  return (
    <>
      <Label htmlFor="booking-patient">Paciente</Label>
      <Input
        id="booking-patient"
        type="search"
        placeholder="Buscar por nombre, documento o teléfono"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query.trim() && <PatientResults patients={data} onChoose={props.onChoose} />}
    </>
  );
}

function PatientResults(props: {
  patients: Patient[] | undefined;
  onChoose: (patient: Patient) => void;
}) {
  if (!props.patients) {
    return null;
  }
  if (props.patients.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">Ningún paciente coincide con la búsqueda.</p>
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {props.patients.map((patient) => (
        <li key={patient.id}>
          <Button type="button" variant="ghost" size="sm" onClick={() => props.onChoose(patient)}>
            {patientName(patient)}
          </Button>
        </li>
      ))}
    </ul>
  );
}
