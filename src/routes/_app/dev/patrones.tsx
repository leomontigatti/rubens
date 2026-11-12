import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { BuildingIcon, CalendarXIcon, UserRoundIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { ColorSwatch } from "#/components/color-swatch.tsx";
import { DataTable, NoMatches, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState, EmptyStateLink } from "#/components/empty-state.tsx";
import { FilterBar } from "#/components/filter-bar.tsx";
import { FormGrid, useAppForm } from "#/components/app-form.tsx";
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
import { NativeSelectOption } from "#/components/ui/native-select.tsx";
import {
  PatientBubble,
  WhatsappBubble,
  WhatsappChat,
  WhatsappDay,
} from "#/components/whatsapp-bubble.tsx";
import { WhatsappStatus } from "#/components/whatsapp-status.tsx";
import { practitionerColorLabels, practitionerColors } from "#/lib/practitioner-colors.ts";

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

function Pattern(props: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`flex flex-col gap-4 ${props.wide ? "" : "max-w-xl"}`}>
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
      submitLabel={props.record ? "Guardar" : "Crear prestación"}
      creates={!props.record}
      record={props.record}
      pending={false}
      onClear={() => undefined}
    >
      <form.AppField name="service">{(field) => <field.TextField label="Nombre" />}</form.AppField>
    </FormPage>
  );
}

function PatternMarkedSelect() {
  const form = useAppForm({ defaultValues: { color: practitionerColors[0] as string } });
  const options = practitionerColors.map((color) => ({
    value: color,
    label: practitionerColorLabels[color],
    mark: <ColorSwatch color={color} />,
  }));
  return (
    <FormGrid>
      <form.AppField name="color">
        {(field) => <field.MarkedSelectField label="Color en la agenda" options={options} />}
      </form.AppField>
    </FormGrid>
  );
}

const patternTemplates = [
  { value: "confirmation", label: "Confirmación del turno", detail: "Al dar el turno" },
  { value: "reminder", label: "Recordatorio", detail: "1 día antes del turno" },
  { value: "followUp", label: "Seguimiento", detail: "1 día después del turno" },
];

/** Several records picked from a list: with picks, and with nothing to pick. */
function PatternMultiCombobox() {
  const form = useAppForm({ defaultValues: { picked: ["reminder"], none: [] as string[] } });
  const shared = {
    emptyText: "No hay plantillas listas para enviar.",
    noMatchText: (query: string) => `Ninguna plantilla lista para enviar coincide con “${query}”.`,
    removeLabel: (name: string) => `Quitar ${name}`,
  };
  return (
    <FormGrid>
      <form.AppField name="picked">
        {(field) => (
          <field.MultiComboboxField
            label="Mensajes por WhatsApp"
            options={patternTemplates}
            {...shared}
          />
        )}
      </form.AppField>
      <form.AppField name="none">
        {(field) => <field.MultiComboboxField label="Sin opciones" options={[]} {...shared} />}
      </form.AppField>
    </FormGrid>
  );
}

/** A text with chips above it, each writing its piece of text in at the cursor. */
function PatternTextInserts() {
  const form = useAppForm({ defaultValues: { body: "Hola , te esperamos." } });
  const inserts = {
    label: "Insertar variable",
    options: [
      { label: "Paciente", text: "{{paciente}}" },
      { label: "Fecha", text: "{{fecha}}" },
    ],
  };
  return (
    <FormGrid>
      <form.AppField name="body">
        {(field) => <field.TextareaField label="Texto" inserts={inserts} />}
      </form.AppField>
    </FormGrid>
  );
}

function PatternFieldSizes() {
  const form = useAppForm({
    defaultValues: {
      firstName: "",
      lastName: "",
      phone: "",
      email: "",
      address: "",
      documentType: "",
      documentNumber: "",
      note: "",
    },
  });
  return (
    <FormGrid>
      <form.AppField name="firstName">
        {(field) => <field.TextField label="Nombre (un cuarto)" />}
      </form.AppField>
      <form.AppField name="lastName">
        {(field) => <field.TextField label="Apellido (un cuarto)" />}
      </form.AppField>
      <form.AppField name="phone">
        {(field) => <field.TextField label="Teléfono (un cuarto)" type="tel" />}
      </form.AppField>
      <form.AppField name="email">
        {(field) => <field.TextField label="Correo electrónico (la mitad)" size="half" startsRow />}
      </form.AppField>
      <form.AppField name="address">
        {(field) => <field.TextField label="Dirección (la mitad)" size="half" />}
      </form.AppField>
      <form.AppField name="documentType">
        {(field) => (
          <field.SelectField label="Tipo de documento (un cuarto)">
            <NativeSelectOption value="">Sin documento</NativeSelectOption>
          </field.SelectField>
        )}
      </form.AppField>
      <form.AppField name="documentNumber">
        {(field) => <field.TextField label="Número de documento (un cuarto)" />}
      </form.AppField>
      <form.AppField name="note">
        {(field) => <field.TextareaField label="Nota (todo el ancho)" />}
      </form.AppField>
    </FormGrid>
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
      subject="closure"
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

/** A save that sends appointments to the list asks first, with two answers; here each is refused. */
function PatternQuestionFormPage() {
  return (
    <EntryForm
      back={{ to: "/dev/patrones" }}
      title="Nuevo cierre"
      subject="closure"
      initial={{ kind: "days", firstDate: "2026-12-24", lastDate: "2026-12-25" }}
      submitLabel="Crear cierre"
      creates
      messages={{ example: "Es un ejemplo: no se guarda nada." }}
      onSubmit={(_, notice) =>
        Promise.resolve(
          notice.tellPatients === undefined
            ? ({ ok: false, reason: "affectsAppointments", affected: 2 } as const)
            : ({ ok: false, reason: "example" } as const),
        )
      }
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
      <Pattern title="Guardado que pregunta, con dos respuestas">
        <PatternQuestionFormPage />
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
      <Pattern title="Campos por tamaño" wide>
        <PatternFieldSizes />
      </Pattern>
      <Pattern title="Lista con marcas">
        <PatternMarkedSelect />
      </Pattern>
      <Pattern title="Varios registros de una lista">
        <PatternMultiCombobox />
      </Pattern>
      <Pattern title="Texto con variables para insertar">
        <PatternTextInserts />
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
          <FieldLabel htmlFor="pattern-records">Lleva historias clínicas</FieldLabel>
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
      <Pattern title="Conversación de WhatsApp">
        <WhatsappChat label="Mensajes">
          <WhatsappDay>Hoy</WhatsappDay>
          <PatientBubble footer="17:41">¿Puedo pasar el turno al viernes?</PatientBubble>
          <PatientBubble
            footer="17:42"
            media={
              <Button variant="outline" size="sm">
                Ver foto
              </Button>
            }
          >
            Foto
          </PatientBubble>
          <PatientBubble
            footer="17:42"
            media={
              <p className="text-muted-foreground text-xs">
                Ya no está disponible en WhatsApp (pasaron más de 7 días)
              </p>
            }
          >
            Archivo: Radiografía.pdf
          </PatientBubble>
          <WhatsappBubble
            author="Rita Prueba"
            footer={
              <>
                17:43
                <WhatsappStatus status="read" />
              </>
            }
          >
            Sí, te lo pasamos al viernes 13 a las 10:30.
          </WhatsappBubble>
          <WhatsappBubble
            author="Rita Prueba"
            pending
            footer={
              <>
                17:50
                <WhatsappStatus status="waiting" />
              </>
            }
          >
            Te esperamos.
          </WhatsappBubble>
        </WhatsappChat>
      </Pattern>
    </div>
  );
}
