import { BuildingIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import * as z from "zod";

import { EmptyState } from "#/components/empty-state.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Field, FieldLabel } from "#/components/ui/field.tsx";
import { defaultTimeZone, officeInputSchema } from "#/lib/offices.ts";
import type { OfficeInput } from "#/lib/offices.ts";
import {
  addOffice,
  changeOfficeActive,
  getOfficeUpcomingCount,
  editOffice,
  getOffices,
} from "#/server/offices.functions.ts";
import type { Office } from "#/server/offices.ts";
import {
  AdminControls,
  CreatePanel,
  ErrorAlert,
  FormActions,
  fieldMessage,
  NameField,
} from "#/components/admin-form.tsx";

import { RefusalAlert, useAction } from "#/routes/_app/sedes/-shared.tsx";
import type { ActionResult } from "#/routes/_app/sedes/-shared.tsx";

export const Route = createFileRoute("/_app/sedes/")({
  head: () => ({ meta: [{ title: "Sedes · Rubens" }] }),
  validateSearch: z.object({ inactivas: z.boolean().optional() }),
  loaderDeps: ({ search }) => ({ includeInactive: search.inactivas ?? false }),
  loader: ({ deps }) => getOffices({ data: deps }),
  component: Offices,
});

const fieldMessages: Record<keyof OfficeInput, string> = {
  name: "Ingresá el nombre de la sede.",
  address: "Ingresá la dirección de la sede.",
  timeZone: "La zona horaria no es válida. Usá un nombre como America/Argentina/Buenos_Aires.",
};

const newOffice = { name: "", address: "", timeZone: defaultTimeZone };

function Offices() {
  const { viewer } = Route.useRouteContext();
  const result = Route.useLoaderData();
  const isAdmin = viewer.roles.includes("admin");

  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Sedes" actions={<ShowInactiveOffices />} />
      <CreatePanel isAdmin={isAdmin} label="Nueva sede">
        {(close) => (
          <OfficeForm
            idPrefix="new"
            initial={newOffice}
            submitLabel="Crear sede"
            onCancel={close}
            onSubmit={(input) => addOffice({ data: input })}
            onDone={close}
          />
        )}
      </CreatePanel>
      <OfficeList offices={result.offices} isAdmin={isAdmin} />
    </div>
  );
}

function ShowInactiveOffices() {
  const { inactivas } = Route.useSearch();
  return (
    <Button
      variant="outline"
      nativeButton={false}
      render={<Link to="/sedes" search={{ inactivas: inactivas ? undefined : true }} />}
    >
      {inactivas ? "Ocultar inactivas" : "Mostrar inactivas"}
    </Button>
  );
}

function OfficeList({ offices, isAdmin }: { offices: Office[]; isAdmin: boolean }) {
  const { inactivas } = Route.useSearch();
  if (offices.length === 0) {
    return (
      <EmptyState
        icon={BuildingIcon}
        title="No hay sedes para mostrar"
        description={`Agregá una con Nueva sede${inactivas ? "" : ", o mirá las inactivas"}.`}
        canAct={isAdmin}
      />
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {offices.map((office) => (
        <OfficeItem key={office.id} office={office} isAdmin={isAdmin} />
      ))}
    </ul>
  );
}

function OfficeItem({ office, isAdmin }: { office: Office; isAdmin: boolean }) {
  const [editing, setEditing] = useState(false);
  const toggle = useAction();

  if (editing) {
    return (
      <li>
        <Card>
          <CardContent>
            <OfficeForm
              idPrefix={office.id}
              initial={office}
              submitLabel="Guardar"
              onCancel={() => setEditing(false)}
              onSubmit={(input) => editOffice({ data: { ...input, officeId: office.id } })}
              onDone={() => setEditing(false)}
            />
          </CardContent>
        </Card>
      </li>
    );
  }

  return (
    <li>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Link
                to="/sedes/$officeId"
                params={{ officeId: office.id }}
                className="font-medium underline-offset-4 hover:underline"
              >
                {office.name}
              </Link>
              {!office.active && <Badge variant="secondary">Inactiva</Badge>}
            </div>
            <span className="text-muted-foreground text-sm">{office.address}</span>
            <span className="text-muted-foreground text-sm">{office.timeZone}</span>
          </div>
          <AdminControls
            isAdmin={isAdmin}
            active={office.active}
            onEdit={() => setEditing(true)}
            deactivation={{
              question: `¿Desactivar ${office.name}?`,
              countUpcoming: () => getOfficeUpcomingCount({ data: { id: office.id } }),
            }}
            onToggleActive={() =>
              void toggle.run(() =>
                changeOfficeActive({ data: { id: office.id, active: !office.active } }),
              )
            }
          />
          <ErrorAlert message={toggle.error} />
        </CardContent>
      </Card>
    </li>
  );
}

interface OfficeFormProps {
  idPrefix: string;
  initial: OfficeInput;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (input: OfficeInput) => Promise<ActionResult>;
  onDone: () => void;
}

function OfficeForm({
  idPrefix,
  initial,
  submitLabel,
  onCancel,
  onSubmit,
  onDone,
}: OfficeFormProps) {
  const action = useAction();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = officeInputSchema.safeParse({
      name: form.get("name"),
      address: form.get("address"),
      timeZone: form.get("timeZone"),
    });
    if (!input.success) {
      action.setError(fieldMessage(fieldMessages, input.error));
      return;
    }
    if (await action.run(() => onSubmit(input.data))) {
      onDone();
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <ErrorAlert message={action.error} />
      <NameField idPrefix={idPrefix} initial={initial.name} />
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-address`}>Dirección</FieldLabel>
        <Input id={`${idPrefix}-address`} name="address" defaultValue={initial.address} required />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-timeZone`}>Zona horaria</FieldLabel>
        <Input
          id={`${idPrefix}-timeZone`}
          name="timeZone"
          defaultValue={initial.timeZone}
          required
        />
      </Field>
      <FormActions pending={action.pending} submitLabel={submitLabel} onCancel={onCancel} />
    </form>
  );
}
