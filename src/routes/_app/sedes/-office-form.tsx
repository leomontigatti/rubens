import type { FormEvent } from "react";

import { NameField, fieldMessage } from "#/components/admin-form.tsx";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { Field, FieldLabel } from "#/components/ui/field.tsx";
import { Input } from "#/components/ui/input.tsx";
import { officeInputSchema } from "#/lib/offices.ts";
import type { OfficeInput } from "#/lib/offices.ts";

import { useAction } from "#/routes/_app/sedes/-shared.tsx";
import type { ActionResult } from "#/routes/_app/sedes/-shared.tsx";

const fieldMessages: Record<keyof OfficeInput, string> = {
  name: "Ingresá el nombre de la sede.",
  address: "Ingresá la dirección de la sede.",
  timeZone: "La zona horaria no es válida. Usá un nombre como America/Argentina/Buenos_Aires.",
};

export function OfficeForm(props: {
  title: string;
  description?: string;
  initial: OfficeInput;
  submitLabel: string;
  onSubmit: (input: OfficeInput) => Promise<ActionResult>;
}) {
  const { initial } = props;
  const page = useFormPage({ to: "/sedes" });
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
    if (await action.save(() => props.onSubmit(input.data))) {
      page.leave();
    }
  }

  return (
    <ActionFormPage
      page={page}
      title={props.title}
      description={props.description}
      submitLabel={props.submitLabel}
      action={action}
      onSubmit={handleSubmit}
    >
      <NameField idPrefix="office" initial={initial.name} />
      <Field>
        <FieldLabel htmlFor="office-address">Dirección</FieldLabel>
        <Input id="office-address" name="address" defaultValue={initial.address} required />
      </Field>
      <Field>
        <FieldLabel htmlFor="office-timeZone">Zona horaria</FieldLabel>
        <Input id="office-timeZone" name="timeZone" defaultValue={initial.timeZone} required />
      </Field>
    </ActionFormPage>
  );
}
