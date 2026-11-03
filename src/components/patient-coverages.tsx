import { Link } from "@tanstack/react-router";

import { ErrorAlert, useFormAction } from "#/components/admin-form.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { NativeSelectOption } from "#/components/ui/native-select.tsx";
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
  const { patientId, initial } = props;
  const page = useFormPage({ to: "/pacientes/$patientId", params: { patientId } });
  const action = useAction();
  const form = useAppForm({
    defaultValues: {
      insurerId: initial.insurerId,
      plan: initial.plan ?? "",
      memberNumber: initial.memberNumber,
    },
    onSubmit: async ({ value }) => {
      const checked = coverageFieldsSchema.safeParse(value);
      if (!checked.success) {
        page.showProblems(fieldProblems(checked.error.issues, messageIn(fieldMessages)));
        return;
      }
      if (await action.save(() => props.onSubmit(checked.data))) {
        page.leave();
      }
    },
  });

  return (
    <ActionFormPage
      page={page}
      form={form}
      title={props.title}
      description={props.description}
      submitLabel={props.submitLabel}
      action={action}
    >
      <form.AppField name="insurerId">
        {(field) => (
          <field.SelectField label="Obra social / prepaga" required>
            <NativeSelectOption value="" disabled>
              Elegí una
            </NativeSelectOption>
            {props.insurers.map((insurer) => (
              <NativeSelectOption key={insurer.id} value={insurer.id}>
                {insurer.name}
              </NativeSelectOption>
            ))}
          </field.SelectField>
        )}
      </form.AppField>
      <div className="grid gap-4 sm:grid-cols-2">
        <form.AppField name="plan">{(field) => <field.TextField label="Plan" />}</form.AppField>
        <form.AppField name="memberNumber">
          {(field) => <field.TextField label="Número de afiliado" required />}
        </form.AppField>
      </div>
    </ActionFormPage>
  );
}
