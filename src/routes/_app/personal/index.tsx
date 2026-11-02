import { UserCogIcon } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import type { FormEvent } from "react";

import { CreatePanel, ErrorAlert, FormActions, fieldMessage } from "#/components/admin-form.tsx";
import { DataTable, NoMatches, RowLink, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Field, FieldDescription, FieldLabel } from "#/components/ui/field.tsx";
import { rolesLabel, staffInputSchema } from "#/lib/staff.ts";
import type { StaffInput } from "#/lib/staff.ts";
import { addStaffMember, getStaff } from "#/server/staff.functions.ts";
import type { StaffMember } from "#/server/staff.ts";

import {
  RefusalAlert,
  RoleCheckboxes,
  formRoles,
  useAction,
} from "#/routes/_app/personal/-shared.tsx";

export const Route = createFileRoute("/_app/personal/")({
  head: () => ({ meta: [{ title: "Personal · Rubens" }] }),
  loader: () => getStaff(),
  component: Staff,
});

const fieldMessages: Record<keyof StaffInput, string> = {
  name: "Ingresá el nombre.",
  email: "Ingresá un correo válido.",
  password: "Ingresá una contraseña inicial.",
  roles: "Elegí al menos un rol.",
};

function Staff() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Personal" />
      <CreatePanel isAdmin label="Nueva persona">
        {(close) => <StaffForm onCancel={close} onDone={close} />}
      </CreatePanel>
      <StaffTable staff={result.staff} />
    </div>
  );
}

const columns: DataTableColumn<StaffMember>[] = [
  {
    id: "name",
    header: "Nombre",
    cell: (member) => (
      <RowLink to="/personal/$memberId" params={{ memberId: member.memberId }}>
        {member.name}
      </RowLink>
    ),
  },
  { id: "email", header: "Correo", cell: (member) => member.email },
  { id: "roles", header: "Roles", cell: (member) => rolesLabel(member.roles) },
  {
    id: "status",
    header: "Estado",
    cell: (member) => !member.active && <Badge variant="secondary">Inactivo</Badge>,
  },
];

function StaffTable(props: { staff: StaffMember[] }) {
  const { table, pager, query, setQuery } = useClientDataTable({
    rows: props.staff,
    columns,
    getRowId: (member) => member.memberId,
    searchText: (member) => `${member.name} ${member.email}`,
  });
  return (
    <DataTable
      table={table}
      pager={pager}
      search={{
        value: query,
        onChange: setQuery,
        label: "Buscar persona",
        placeholder: "Buscar por nombre o correo",
      }}
      empty={<NoMatches icon={UserCogIcon} />}
    />
  );
}

function StaffForm({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const action = useAction();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = staffInputSchema.safeParse({
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
      roles: formRoles(form),
    });
    if (!input.success) {
      action.setError(fieldMessage(fieldMessages, input.error));
      return;
    }
    if (await action.run(() => addStaffMember({ data: input.data }))) {
      onDone();
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <ErrorAlert message={action.error} />
      <Field>
        <FieldLabel htmlFor="new-name">Nombre</FieldLabel>
        <Input id="new-name" name="name" required />
      </Field>
      <Field>
        <FieldLabel htmlFor="new-email">Correo</FieldLabel>
        <Input id="new-email" name="email" type="email" required />
      </Field>
      <Field>
        <FieldLabel htmlFor="new-password">Contraseña inicial</FieldLabel>
        <Input
          id="new-password"
          name="password"
          type="text"
          autoComplete="off"
          required
          aria-describedby="new-password-hint"
        />
        <FieldDescription id="new-password-hint">
          La persona la usa para ingresar la primera vez y la cambia al entrar.
        </FieldDescription>
      </Field>
      <RoleCheckboxes idPrefix="new" initial={[]} />
      <FormActions pending={action.pending} submitLabel="Crear cuenta" onCancel={onCancel} />
    </form>
  );
}
