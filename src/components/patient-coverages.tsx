import { useState } from "react";
import type { FormEvent } from "react";

import { ErrorAlert, FormActions, fieldMessage, useFormAction } from "#/components/admin-form.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import {
  coverageInputSchema,
  coverageLabel,
  insurerKindLabels,
  privateCoverageLabel,
} from "#/lib/coverages.ts";
import type { CoverageInput } from "#/lib/coverages.ts";
import {
  addPatientCoverage,
  changePrimaryCoverage,
  deleteCoverage,
  editCoverage,
} from "#/server/coverages.functions.ts";
import type { Coverage } from "#/server/coverages.ts";
import type { Insurer } from "#/server/insurers.ts";

// The coverages section of the patient page: the list, "Particular" when it is
// empty, and the add and edit form, which offers active insurers only.

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "No tenés permiso para cambiar las coberturas de este paciente.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "No encontramos esa cobertura.",
  insurerInactive: "Esa obra social o prepaga está desactivada. Elegí otra.",
};

type ActionResult = { ok: true } | { ok: false; reason: keyof typeof refusalMessages };

type CoverageFields = Pick<CoverageInput, "insurerId" | "plan" | "memberNumber">;

const fieldMessages: Record<keyof CoverageFields, string> = {
  insurerId: "Elegí la obra social o prepaga.",
  plan: "El plan es demasiado largo.",
  memberNumber: "Ingresá el número de afiliado.",
};

const coverageFieldsSchema = coverageInputSchema.pick({
  insurerId: true,
  plan: true,
  memberNumber: true,
});

function useAction() {
  return useFormAction(refusalMessages);
}

export function CoverageList(props: { coverages: Coverage[]; insurers: Insurer[] }) {
  if (props.coverages.length === 0) {
    return <p>{privateCoverageLabel}</p>;
  }
  return (
    <ul className="flex flex-col gap-4">
      {props.coverages.map((coverage) => (
        <CoverageItem key={coverage.id} coverage={coverage} insurers={props.insurers} />
      ))}
    </ul>
  );
}

function CoverageItem({ coverage, insurers }: { coverage: Coverage; insurers: Insurer[] }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li>
        <CoverageForm
          idPrefix={coverage.id}
          initial={coverage}
          insurers={offeredInsurers(insurers, coverage)}
          submitLabel="Guardar"
          onSubmit={(fields) => editCoverage({ data: { ...fields, coverageId: coverage.id } })}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-start justify-between gap-4">
      <CoverageSummary coverage={coverage} />
      <CoverageControls coverage={coverage} onEdit={() => setEditing(true)} />
    </li>
  );
}

/**
 * The insurers a coverage's form offers: the active ones, and the coverage's
 * own when it was deactivated since, so an edit can keep it.
 */
function offeredInsurers(insurers: Insurer[], coverage: Coverage): Insurer[] {
  if (coverage.insurerActive) {
    return insurers;
  }
  const own: Insurer = {
    id: coverage.insurerId,
    name: coverage.insurerName,
    kind: coverage.insurerKind,
    active: false,
  };
  return [own, ...insurers];
}

function CoverageSummary({ coverage }: { coverage: Coverage }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{coverageLabel(coverage)}</span>
        {coverage.primary && <Badge variant="outline">Principal</Badge>}
      </p>
      <p className="text-muted-foreground text-sm">
        {insurerKindLabels[coverage.insurerKind]}
        {!coverage.insurerActive && " (desactivada)"} · N.º de afiliado {coverage.memberNumber}
      </p>
    </div>
  );
}

function CoverageControls({ coverage, onEdit }: { coverage: Coverage; onEdit: () => void }) {
  const action = useAction();
  const data = { coverageId: coverage.id };
  return (
    <div className="flex flex-col items-end gap-3">
      <div className="flex flex-wrap gap-2">
        {!coverage.primary && (
          <Button
            variant="outline"
            size="sm"
            disabled={action.pending}
            onClick={() => void action.run(() => changePrimaryCoverage({ data }))}
          >
            Hacer principal
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onEdit}>
          Editar
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={action.pending}
          onClick={() => void action.run(() => deleteCoverage({ data }))}
        >
          Quitar
        </Button>
      </div>
      <ErrorAlert message={action.error} />
    </div>
  );
}

/** The form that adds a coverage to the patient. */
export function NewCoverageForm(props: {
  patientId: string;
  insurers: Insurer[];
  onDone: () => void;
}) {
  if (props.insurers.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-muted-foreground">
          No hay obras sociales ni prepagas activas. Un administrador las agrega en "Obras
          sociales".
        </p>
        <Button variant="ghost" onClick={props.onDone}>
          Cancelar
        </Button>
      </div>
    );
  }
  return (
    <CoverageForm
      idPrefix="new-coverage"
      initial={{ insurerId: "", plan: null, memberNumber: "" }}
      insurers={props.insurers}
      submitLabel="Agregar"
      onSubmit={(fields) => addPatientCoverage({ data: { ...fields, patientId: props.patientId } })}
      onDone={props.onDone}
    />
  );
}

interface CoverageFormProps {
  idPrefix: string;
  initial: CoverageFields;
  insurers: Insurer[];
  submitLabel: string;
  onSubmit: (fields: CoverageFields) => Promise<ActionResult>;
  onDone: () => void;
}

function CoverageForm(props: CoverageFormProps) {
  const action = useAction();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const checked = coverageFieldsSchema.safeParse({
      insurerId: form.get("insurerId"),
      plan: form.get("plan"),
      memberNumber: form.get("memberNumber"),
    });
    if (!checked.success) {
      action.setError(fieldMessage(fieldMessages, checked.error));
      return;
    }
    if (await action.run(() => props.onSubmit(checked.data))) {
      props.onDone();
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <ErrorAlert message={action.error} />
      <InsurerSelect
        id={`${props.idPrefix}-insurerId`}
        insurers={props.insurers}
        initial={props.initial.insurerId}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${props.idPrefix}-plan`}>Plan</Label>
          <Input
            id={`${props.idPrefix}-plan`}
            name="plan"
            defaultValue={props.initial.plan ?? ""}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${props.idPrefix}-memberNumber`}>Número de afiliado</Label>
          <Input
            id={`${props.idPrefix}-memberNumber`}
            name="memberNumber"
            defaultValue={props.initial.memberNumber}
            required
          />
        </div>
      </div>
      <FormActions
        pending={action.pending}
        submitLabel={props.submitLabel}
        onCancel={props.onDone}
      />
    </form>
  );
}

function InsurerSelect(props: { id: string; insurers: Insurer[]; initial: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={props.id}>Obra social / prepaga</Label>
      <NativeSelect id={props.id} name="insurerId" defaultValue={props.initial} required>
        <NativeSelectOption value="" disabled>
          Elegí una
        </NativeSelectOption>
        {props.insurers.map((insurer) => (
          <NativeSelectOption key={insurer.id} value={insurer.id}>
            {insurer.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
