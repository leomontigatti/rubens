import { createFileRoute, notFound } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { PageHeader } from "#/components/page-header.tsx";
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

function Patterns() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Patrones" description="Cómo se ve cada patrón de la guía de estilo." />
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
      <Pattern title="Filtros en una fila">
        <div className="flex flex-wrap items-end gap-4">
          <Field className="w-auto">
            <FieldLabel htmlFor="pattern-room">Consultorio</FieldLabel>
            <NativeSelect id="pattern-room">
              <NativeSelectOption value="">Consultorio 1</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field className="w-auto">
            <FieldLabel htmlFor="pattern-practitioner">Profesional</FieldLabel>
            <NativeSelect id="pattern-practitioner">
              <NativeSelectOption value="">Todos</NativeSelectOption>
            </NativeSelect>
          </Field>
        </div>
      </Pattern>
      <Pattern title="Casilla">
        <Field orientation="horizontal">
          <Checkbox id="pattern-records" />
          <FieldLabel htmlFor="pattern-records">Lleva historia clínica</FieldLabel>
        </Field>
      </Pattern>
      <Pattern title="Grupo de casillas">
        <FieldSet>
          <FieldLegend variant="label">Roles</FieldLegend>
          <FieldGroup data-slot="checkbox-group">
            <Field orientation="horizontal">
              <Checkbox id="pattern-reception" />
              <FieldLabel htmlFor="pattern-reception">Recepción</FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Checkbox id="pattern-practitioner-role" />
              <FieldLabel htmlFor="pattern-practitioner-role">Profesional</FieldLabel>
            </Field>
          </FieldGroup>
        </FieldSet>
      </Pattern>
    </div>
  );
}
