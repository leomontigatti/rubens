import type { FormEvent } from "react";

import { NameField, fieldMessage, useFormAction } from "#/components/admin-form.tsx";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { Field, FieldLabel } from "#/components/ui/field.tsx";
import { Input } from "#/components/ui/input.tsx";
import { medicalServiceInputSchema } from "#/lib/medical-services.ts";
import type { MedicalServiceFields } from "#/lib/medical-services.ts";

import { refusalMessages } from "#/routes/_app/prestaciones/-shared.ts";
import type { RefusalReason } from "#/routes/_app/prestaciones/-shared.ts";

type ActionResult = { ok: true } | { ok: false; reason: RefusalReason };

const fieldMessages: Record<keyof MedicalServiceFields | "practitionerId", string> = {
  practitionerId: "No encontramos ese profesional.",
  name: "Ingresá el nombre.",
  durationMinutes: "La duración tiene que ser de 1 a 720 minutos.",
};

const fieldsSchema = medicalServiceInputSchema.omit({ practitionerId: true });

export function MedicalServiceForm(props: {
  practitionerId: string;
  title: string;
  description?: string;
  initial: MedicalServiceFields;
  submitLabel: string;
  onSubmit: (fields: MedicalServiceFields) => Promise<ActionResult>;
}) {
  const { initial, practitionerId } = props;
  const page = useFormPage({ to: "/prestaciones/$practitionerId", params: { practitionerId } });
  const action = useFormAction(refusalMessages);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = fieldsSchema.safeParse({
      name: form.get("name"),
      durationMinutes: Number(form.get("durationMinutes")),
    });
    if (!fields.success) {
      action.setError(fieldMessage(fieldMessages, fields.error));
      return;
    }
    if (await action.run(() => props.onSubmit(fields.data))) {
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
      <NameField idPrefix="service" initial={initial.name} />
      <Field>
        <FieldLabel htmlFor="service-duration">Duración (minutos)</FieldLabel>
        <Input
          id="service-duration"
          name="durationMinutes"
          type="number"
          min={1}
          max={720}
          step={1}
          defaultValue={initial.durationMinutes}
          required
        />
      </Field>
    </ActionFormPage>
  );
}
