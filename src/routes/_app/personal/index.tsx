import { Link, createFileRoute } from "@tanstack/react-router";
import type { FormEvent } from "react";

import { CreatePanel, ErrorAlert, FormActions, fieldMessage } from "#/components/admin-form.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { staffInputSchema } from "#/lib/staff.ts";
import type { StaffInput } from "#/lib/staff.ts";
import { addStaffMember, getStaff } from "#/server/staff.functions.ts";
import type { StaffMember } from "#/server/staff.ts";

import {
  RefusalAlert,
  RoleCheckboxes,
  formRoles,
  rolesLabel,
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
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Personal</h1>
      <CreatePanel isAdmin label="Nueva persona">
        {(close) => <StaffForm onCancel={close} onDone={close} />}
      </CreatePanel>
      <ul className="flex flex-col gap-3">
        {result.staff.map((member) => (
          <StaffItem key={member.memberId} member={member} />
        ))}
      </ul>
    </div>
  );
}

function StaffItem({ member }: { member: StaffMember }) {
  return (
    <li>
      <Card>
        <CardContent className="flex flex-col gap-1">
          <Link
            to="/personal/$memberId"
            params={{ memberId: member.memberId }}
            className="font-medium underline-offset-4 hover:underline"
          >
            {member.name}
          </Link>
          <span className="text-muted-foreground text-sm">{member.email}</span>
          <span className="text-muted-foreground text-sm">
            {rolesLabel(member.roles)}
            {!member.active && " · Inactivo"}
          </span>
        </CardContent>
      </Card>
    </li>
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
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <ErrorAlert message={action.error} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-name">Nombre</Label>
        <Input id="new-name" name="name" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-email">Correo</Label>
        <Input id="new-email" name="email" type="email" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-password">Contraseña inicial</Label>
        <Input id="new-password" name="password" type="text" autoComplete="off" required />
        <p className="text-muted-foreground text-sm">
          La persona la usa para ingresar la primera vez y la cambia al entrar.
        </p>
      </div>
      <RoleCheckboxes idPrefix="new" initial={[]} />
      <FormActions pending={action.pending} submitLabel="Crear cuenta" onCancel={onCancel} />
    </form>
  );
}
