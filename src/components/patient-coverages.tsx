import { ShieldIcon } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { ActionsMenu, ArchivedBadge, useFormAction } from "#/components/admin-form.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { DataTable, RowName, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { ActionFormPage, CreateButton, useFormPage } from "#/components/form-page.tsx";
import type { RecordHeader } from "#/components/form-page.tsx";
import { DropdownMenuItem } from "#/components/ui/dropdown-menu.tsx";
import {
  coverageInputSchema,
  coverageLabel,
  insurerKindLabels,
  privateCoverageLabel,
} from "#/lib/coverages.ts";
import type { CoverageInput } from "#/lib/coverages.ts";
import { deleteCoverage } from "#/server/coverages.functions.ts";
import type { Coverage } from "#/organization/coverages.ts";
import type { Insurer } from "#/organization/insurers.ts";

// The coverage section of the patient page: the patient's one coverage, or
// "Particular" when they have none, and the add and edit page's form, which
// offers active insurers only.

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "No tenés permiso para cambiar las coberturas de este paciente.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "No encontramos esa cobertura.",
  insurerInactive: "Esa obra social o prepaga está archivada. Elegí otra.",
  hasCoverage: "El paciente ya tiene una cobertura. Editala o quitala.",
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

/** A coverage in the patient's list, with the patient its page hangs off. */
type ListedCoverage = Coverage & { patientId: string };

const coverageColumns: DataTableColumn<ListedCoverage>[] = [
  {
    id: "name",
    header: "Obra social o prepaga",
    cell: (coverage) => (
      <RowName
        name={coverageLabel(coverage)}
        link={{
          to: "/pacientes/$patientId/coberturas/$coverageId",
          params: { patientId: coverage.patientId, coverageId: coverage.id },
        }}
        status={<ArchivedBadge active={coverage.insurerActive} ending="a" />}
      />
    ),
  },
  {
    id: "kind",
    header: "Tipo",
    cell: (coverage) => insurerKindLabels[coverage.insurerKind],
  },
  { id: "plan", header: "Plan", cell: (coverage) => coverage.plan },
  { id: "member", header: "N.º de afiliado", cell: (coverage) => coverage.memberNumber },
];

/**
 * The patient's coverage, in the patient page's `Cobertura` tab: its name opens
 * its page; with none, `Particular` and `Agregar cobertura`.
 */
export function CoverageList(props: { patientId: string; coverages: Coverage[] }) {
  const { table } = useClientDataTable({
    rows: props.coverages.map((coverage) => ({ ...coverage, patientId: props.patientId })),
    columns: coverageColumns,
    getRowId: (coverage) => coverage.id,
  });
  return (
    <DataTable
      table={table}
      noRecords={props.coverages.length === 0}
      empty={
        <EmptyState
          icon={ShieldIcon}
          title="Sin cobertura"
          description={`${privateCoverageLabel}: no tiene obra social ni prepaga cargada.`}
        >
          <CreateButton
            link={
              <Link
                to="/pacientes/$patientId/coberturas/nueva"
                params={{ patientId: props.patientId }}
              />
            }
          >
            Agregar cobertura
          </CreateButton>
        </EmptyState>
      }
    />
  );
}

/** A coverage's page's `Acciones`: `Quitar`, which asks first and goes back to the patient's coverage. */
export function useCoverageRecord(patientId: string, coverage: Coverage): RecordHeader {
  const action = useAction();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const data = { coverageId: coverage.id };
  const back = () =>
    void navigate({
      to: "/pacientes/$patientId",
      params: { patientId },
      search: { seccion: "coberturas" },
    });
  return {
    actions: (busy) => (
      <>
        <ActionsMenu disabled={action.pending || busy}>
          <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
            Quitar
          </DropdownMenuItem>
        </ActionsMenu>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title="¿Quitar esta cobertura?"
          description="El paciente deja de tenerla y queda como particular."
          confirmLabel="Quitar"
          onConfirm={() =>
            void action.save(() => deleteCoverage({ data })).then((removed) => removed && back())
          }
        />
      </>
    ),
    error: action.error,
  };
}

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

export function CoverageForm(props: {
  patientId: string;
  title: string;
  description: string;
  initial: CoverageFields;
  insurers: Insurer[];
  submitLabel: string;
  creates?: boolean;
  /** An existing coverage's `Acciones` (`useCoverageRecord`). */
  record?: RecordHeader;
  onSubmit: (fields: CoverageFields) => Promise<ActionResult>;
}) {
  const { patientId, initial } = props;
  const page = useFormPage({
    to: "/pacientes/$patientId",
    params: { patientId },
    search: { seccion: "coberturas" },
  });
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
      creates={props.creates}
      record={props.record}
      action={action}
    >
      <form.AppField name="insurerId">
        {(field) => (
          <field.SelectField
            label="Obra social / prepaga"
            required
            placeholder="Elegí una"
            options={props.insurers.map((insurer) => ({ value: insurer.id, label: insurer.name }))}
          />
        )}
      </form.AppField>
      <form.AppField name="plan">{(field) => <field.TextField label="Plan" />}</form.AppField>
      <form.AppField name="memberNumber">
        {(field) => <field.TextField label="Número de afiliado" required />}
      </form.AppField>
    </ActionFormPage>
  );
}
