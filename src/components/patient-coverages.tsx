import { Link } from "@tanstack/react-router";
import type { FormEvent } from "react";

import { ErrorAlert, fieldMessage, useFormAction } from "#/components/admin-form.tsx";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Field, FieldLabel } from "#/components/ui/field.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import {
  coverageInputSchema,
  coverageLabel,
  insurerKindLabels,
  privateCoverageLabel,
} from "#/lib/coverages.ts";
import type { CoverageInput } from "#/lib/coverages.ts";
import { changePrimaryCoverage, deleteCoverage } from "#/server/coverages.functions.ts";
import type { Coverage } from "#/server/coverages.ts";
import type { Insurer } from "#/server/insurers.ts";

// The coverages section of the patient page: the list, "Particular" when it is
// empty, and the add and edit page's form, which offers active insurers only.

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

export function CoverageList(props: { patientId: string; coverages: Coverage[] }) {
  if (props.coverages.length === 0) {
    return <p>{privateCoverageLabel}</p>;
  }
  return (
    <ul className="flex flex-col gap-4">
      {props.coverages.map((coverage) => (
        <li key={coverage.id} className="flex flex-wrap items-start justify-between gap-4">
          <CoverageSummary coverage={coverage} />
          <CoverageControls patientId={props.patientId} coverage={coverage} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The insurers a coverage's form offers: the active ones, and the coverage's
 * own when it was deactivated since, so an edit can keep it.
 */
export function offeredInsurers(insurers: Insurer[], coverage: Coverage): Insurer[] {
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

function CoverageControls({ patientId, coverage }: { patientId: string; coverage: Coverage }) {
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
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={
            <Link
              to="/pacientes/$patientId/coberturas/$coverageId"
              params={{ patientId, coverageId: coverage.id }}
            />
          }
        >
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

export function CoverageForm(props: {
  patientId: string;
  title: string;
  description: string;
  initial: CoverageFields;
  insurers: Insurer[];
  submitLabel: string;
  onSubmit: (fields: CoverageFields) => Promise<ActionResult>;
}) {
  const { patientId } = props;
  const page = useFormPage({ to: "/pacientes/$patientId", params: { patientId } });
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
      page.leave();
    }
  }

  return (
    <ActionFormPage
      page={page}
      title={props.title}
      description={props.description}
      submitLabel={props.submitLabel}
      action={action}
      onSubmit={handleSubmit}
    >
      <InsurerSelect
        id="coverage-insurerId"
        insurers={props.insurers}
        initial={props.initial.insurerId}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="coverage-plan">Plan</FieldLabel>
          <Input id="coverage-plan" name="plan" defaultValue={props.initial.plan ?? ""} />
        </Field>
        <Field>
          <FieldLabel htmlFor="coverage-memberNumber">Número de afiliado</FieldLabel>
          <Input
            id="coverage-memberNumber"
            name="memberNumber"
            defaultValue={props.initial.memberNumber}
            required
          />
        </Field>
      </div>
    </ActionFormPage>
  );
}

function InsurerSelect(props: { id: string; insurers: Insurer[]; initial: string }) {
  return (
    <Field>
      <FieldLabel htmlFor={props.id}>Obra social / prepaga</FieldLabel>
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
    </Field>
  );
}
