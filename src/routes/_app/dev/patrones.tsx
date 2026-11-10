import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { BuildingIcon, CalendarXIcon, UserRoundIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { DataTable, NoMatches, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState, EmptyStateLink } from "#/components/empty-state.tsx";
import { FilterBar } from "#/components/filter-bar.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { activeRecord } from "#/components/admin-form.tsx";
import { CreateButton, FormPage, useFormPage } from "#/components/form-page.tsx";
import type { RecordHeader } from "#/components/form-page.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { MorePatientMatches } from "#/components/patient-search-more.tsx";
import { EntryForm } from "#/components/range-entry.tsx";
import { Detail, RecordSection } from "#/components/record-section.tsx";
import { showSaveFailed } from "#/components/save-failure.ts";
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
import { WhatsappBubble, WhatsappChat } from "#/components/whatsapp-bubble.tsx";

// Each pattern of docs/agents/style-guide.md, drawn once, so an agent or a
// reviewer can compare a screen with it. Only `pnpm dev` serves this page.
export const Route = createFileRoute("/_app/dev/patrones")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw notFound();
    }
  },
  head: () => ({ meta: [{ title: "Patrones · underthing" }] }),
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

/** A short fixed list: no search, only the rows and their count. */
function PatternFixedTable() {
  const { table, pager } = useClientDataTable({
    rows: patternRows,
    columns: patternColumns,
    getRowId: (row) => row.id,
  });
  return <DataTable table={table} pager={pager} empty={null} />;
}

/** A page of settings: one section per setting, each with its own form page or link. */
function PatternSettings() {
  return (
    <div className="flex flex-col gap-6">
      <RecordSection
        title="Devolución al asistente"
        action={
          <Button variant="outline" size="sm">
            Editar
          </Button>
        }
      >
        <dl>
          <Detail label="Vuelve al asistente después de" value="4 horas" />
        </dl>
      </RecordSection>
      <RecordSection
        title="Prueba del asistente"
        action={
          <Button variant="outline" size="sm">
            Probar
          </Button>
        }
      >
        <p className="text-muted-foreground text-sm">
          Escribí como un paciente y mirá qué responde el asistente.
        </p>
      </RecordSection>
    </div>
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

function PatternFormPage(props: { title: string; record?: RecordHeader }) {
  const page = useFormPage({ to: "/dev/patrones" });
  const form = useAppForm({
    defaultValues: { service: "" },
    onSubmit: () => page.showProblems([{ field: "service", message: "Ingresá el nombre." }]),
  });
  return (
    <FormPage
      page={page}
      form={form}
      title={props.title}
      submitLabel={props.record ? "Guardar" : "Crear"}
      creates={!props.record}
      record={props.record}
      pending={false}
      onClear={() => undefined}
    >
      <form.AppField name="service">{(field) => <field.TextField label="Nombre" />}</form.AppField>
    </FormPage>
  );
}

/** An edit page that is its record's only page: its status and toggle beside the title. */
function PatternRecordFormPage() {
  const [active, setActive] = useState(true);
  return (
    <PatternFormPage
      title="Editar prestación"
      record={activeRecord({
        active,
        inactiveLabel: "Inactiva",
        toggle: { pending: false, error: null },
        onChange: setActive,
      })}
    />
  );
}

/** A delete beside the title: it asks first; here it is refused, so the page stays. */
function PatternDeletionFormPage() {
  return (
    <EntryForm
      back={{ to: "/dev/patrones" }}
      title="Editar cierre"
      initial={{ kind: "days", firstDate: "2026-12-24", lastDate: "2026-12-25" }}
      submitLabel="Guardar"
      messages={{ example: "Es un ejemplo: no se elimina nada." }}
      deletion={{
        question: "¿Eliminar este cierre?",
        notice: "El cierre se borra y no se puede recuperar.",
        onDelete: () => Promise.resolve({ ok: false, reason: "example" as const }),
      }}
      onSubmit={() => Promise.resolve({ ok: false, reason: "example" as const })}
    />
  );
}

function Patterns() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Patrones" description="Cómo se ve cada patrón de la guía de estilo." />
      <Pattern title="Página de formulario">
        <PatternFormPage title="Nueva prestación" />
      </Pattern>
      <Pattern title="Edición de un registro sin página propia">
        <PatternRecordFormPage />
        <PatternDeletionFormPage />
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
      <Pattern title="Página de configuración">
        <PatternSettings />
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
      <Pattern title="Lista fija, sin búsqueda">
        <PatternFixedTable />
      </Pattern>
      <Pattern title="Búsqueda de pacientes con más coincidencias">
        <MorePatientMatches
          search={{
            searching: true,
            waiting: false,
            found: { ok: true, patients: Array.from({ length: 20 }), more: true },
            failed: false,
          }}
        />
      </Pattern>
      <Pattern title="Sin datos">
        <EmptyState
          icon={BuildingIcon}
          title="Sin sedes"
          description="Todavía no hay sedes. Empezá creando la primera."
        >
          <CreateButton link={<Link to="/sedes/nueva" />}>Nueva sede</CreateButton>
        </EmptyState>
      </Pattern>
      <Pattern title="Sin datos activos">
        <EmptyState
          icon={BuildingIcon}
          title="Sin sedes activas"
          description="No hay sedes activas. Empezá creando una, o mirá las inactivas."
        >
          <CreateButton link={<Link to="/sedes/nueva" />}>Nueva sede</CreateButton>
          <EmptyStateLink
            variant="outline"
            link={<Link to="/sedes" search={{ inactivas: true }} />}
          >
            Ver inactivas
          </EmptyStateLink>
        </EmptyState>
      </Pattern>
      <Pattern title="Sin datos, sin permiso para agregar">
        <EmptyState
          icon={CalendarXIcon}
          title="Sin cierres"
          description="Todavía no hay cierres."
        />
      </Pattern>
      <Pattern title="Búsqueda sin resultados">
        <NoMatches icon={UsersIcon} />
      </Pattern>
      <Pattern title="Aviso de un guardado que falló">
        <Button variant="outline" className="w-fit" onClick={showSaveFailed}>
          Mostrar el aviso
        </Button>
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
      <Pattern title="Mensaje de WhatsApp">
        <WhatsappChat label="Así lo lee el paciente">
          <WhatsappBubble>
            {
              "Hola Lucía, tu turno es el jueves 12 de noviembre a las 10:30.\n\nConsultorios Prueba"
            }
          </WhatsappBubble>
        </WhatsappChat>
      </Pattern>
    </div>
  );
}
