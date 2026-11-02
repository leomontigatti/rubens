import { createFileRoute, notFound } from "@tanstack/react-router";
import { BuildingIcon, CalendarXIcon, UserRoundIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { DataTable, NoMatches, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { FilterBar } from "#/components/filter-bar.tsx";
import { CreateSheet } from "#/components/form-sheet.tsx";
import { FormActions } from "#/components/admin-form.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Detail, RecordSection } from "#/components/record-section.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "#/components/ui/field.tsx";
import { Input } from "#/components/ui/input.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";

// Each pattern of docs/agents/style-guide.md, drawn once, so an agent or a
// reviewer can compare a screen with it. Only `pnpm dev` serves this page.
export const Route = createFileRoute("/_app/dev/patrones")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw notFound();
    }
  },
  head: () => ({ meta: [{ title: "Patrones · Rubens" }] }),
  component: Patterns,
});

function Pattern(props: { title: string; children: ReactNode }) {
  return (
    <section className="flex max-w-xl flex-col gap-4">
      <h2 className="text-lg font-semibold">{props.title}</h2>
      {props.children}
    </section>
  );
}

const patternColumns: DataTableColumn<{ id: string; name: string; insurer: string }>[] = [
  { id: "name", header: "Nombre", cell: (row) => row.name },
  { id: "insurer", header: "Obra social", cell: (row) => row.insurer },
];

const patternRows = [
  { id: "1", name: "Ana Gómez", insurer: "Particular" },
  { id: "2", name: "Juan Pérez", insurer: "OSDE" },
];

function PatternTable() {
  const { table, pager, query, setQuery } = useClientDataTable({
    rows: patternRows,
    columns: patternColumns,
    getRowId: (row) => row.id,
    searchText: (row) => row.name,
  });
  return (
    <DataTable
      table={table}
      pager={pager}
      search={{
        value: query,
        onChange: setQuery,
        label: "Buscar paciente",
        placeholder: "Buscar por nombre",
      }}
      empty={<NoMatches icon={UsersIcon} />}
    />
  );
}

function PatternFilters() {
  const [practitioner, setPractitioner] = useState<string | null>("laura");
  return (
    <FilterBar
      groups={[
        {
          id: "room",
          label: "Consultorio",
          icon: BuildingIcon,
          required: true,
          value: "room-1",
          options: [{ value: "room-1", label: "Consultorio 1", section: "Sede Centro" }],
        },
        {
          id: "practitioner",
          label: "Profesional",
          icon: UserRoundIcon,
          value: practitioner,
          options: [
            { value: "laura", label: "Dra. Laura Díaz" },
            { value: "pablo", label: "Dr. Pablo Ruiz" },
          ],
        },
      ]}
      onPick={(_, value) => setPractitioner(value)}
      onRemove={() => setPractitioner(null)}
    />
  );
}

function Patterns() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Patrones" description="Cómo se ve cada patrón de la guía de estilo." />
      <Pattern title="Panel lateral">
        <CreateSheet canCreate label="Nueva prestación">
          {(close) => (
            <form
              noValidate
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                close();
              }}
            >
              <Field>
                <FieldLabel htmlFor="pattern-service">Nombre</FieldLabel>
                <Input id="pattern-service" />
              </Field>
              <FormActions pending={false} submitLabel="Crear" onCancel={close} />
            </form>
          )}
        </CreateSheet>
      </Pattern>
      <Pattern title="Sección de un registro">
        <RecordSection
          title="Datos"
          action={
            <Button variant="outline" size="sm">
              Editar
            </Button>
          }
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Nombre" value="Ana Gómez" />
            <Detail label="Correo electrónico" value={null} />
          </dl>
        </RecordSection>
      </Pattern>
      <Pattern title="Campo">
        <Field>
          <FieldLabel htmlFor="pattern-name">Nombre</FieldLabel>
          <Input id="pattern-name" />
        </Field>
      </Pattern>
      <Pattern title="Campo con ayuda">
        <Field>
          <FieldLabel htmlFor="pattern-phone">Teléfono</FieldLabel>
          <Input id="pattern-phone" type="tel" aria-describedby="pattern-phone-hint" />
          <FieldDescription id="pattern-phone-hint">
            Con código de área, como se dice: 0351 15 555-1234.
          </FieldDescription>
        </Field>
      </Pattern>
      <Pattern title="Campos en dos columnas">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="pattern-type">Tipo de documento</FieldLabel>
            <NativeSelect id="pattern-type">
              <NativeSelectOption value="">Sin documento</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="pattern-number">Número de documento</FieldLabel>
            <Input id="pattern-number" />
          </Field>
        </div>
      </Pattern>
      <Pattern title="Filtros">
        <div className="flex flex-wrap items-center gap-2">
          <PatternFilters />
        </div>
      </Pattern>
      <Pattern title="Tabla">
        <PatternTable />
      </Pattern>
      <Pattern title="Sin datos">
        <EmptyState
          icon={CalendarXIcon}
          title="Todavía no hay cierres"
          description="Agregá el primero con Nuevo cierre."
        />
      </Pattern>
      <Pattern title="Casilla">
        <Field orientation="horizontal" className="w-fit">
          <Checkbox id="pattern-records" />
          <FieldLabel htmlFor="pattern-records">Lleva historia clínica</FieldLabel>
        </Field>
      </Pattern>
      <Pattern title="Grupo de casillas">
        <FieldSet>
          <FieldLegend variant="label">Roles</FieldLegend>
          <FieldGroup data-slot="checkbox-group">
            <Field orientation="horizontal" className="w-fit">
              <Checkbox id="pattern-reception" />
              <FieldLabel htmlFor="pattern-reception">Recepción</FieldLabel>
            </Field>
            <Field orientation="horizontal" className="w-fit">
              <Checkbox id="pattern-practitioner-role" />
              <FieldLabel htmlFor="pattern-practitioner-role">Profesional</FieldLabel>
            </Field>
          </FieldGroup>
        </FieldSet>
      </Pattern>
    </div>
  );
}
