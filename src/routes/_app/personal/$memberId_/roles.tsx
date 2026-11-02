import { createFileRoute } from "@tanstack/react-router";
import type { FormEvent } from "react";

import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { rolesChangeSchema } from "#/lib/staff.ts";
import { editRoles, getMember } from "#/server/staff.functions.ts";
import type { StaffMember } from "#/server/staff.ts";

import {
  RefusalAlert,
  RoleCheckboxes,
  formRoles,
  useAction,
} from "#/routes/_app/personal/-shared.tsx";

export const Route = createFileRoute("/_app/personal/$memberId_/roles")({
  loader: ({ params }) => getMember({ data: { memberId: params.memberId } }),
  head: () => ({ meta: [{ title: "Editar roles · Rubens" }] }),
  component: EditRoles,
});

function EditRoles() {
  const result = Route.useLoaderData();
  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }
  return <RolesForm member={result.member} />;
}

function RolesForm({ member }: { member: StaffMember }) {
  const { memberId } = member;
  const page = useFormPage({ to: "/personal/$memberId", params: { memberId } });
  const action = useAction();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = rolesChangeSchema.safeParse({
      memberId,
      roles: formRoles(new FormData(event.currentTarget)),
    });
    if (!input.success) {
      action.setError("Elegí al menos un rol.");
      return;
    }
    if (await action.save(() => editRoles({ data: input.data }))) {
      page.leave();
    }
  }

  return (
    <ActionFormPage
      page={page}
      title="Editar roles"
      description={member.name}
      submitLabel="Guardar"
      action={action}
      onSubmit={handleSubmit}
    >
      <RoleCheckboxes idPrefix={memberId} initial={member.roles} />
    </ActionFormPage>
  );
}
