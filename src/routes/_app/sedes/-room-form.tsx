import type { FormEvent } from "react";
import type * as z from "zod";

import { NameField, fieldMessage } from "#/components/admin-form.tsx";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { Field, FieldLabel } from "#/components/ui/field.tsx";
import { Input } from "#/components/ui/input.tsx";
import { roomUpdateSchema } from "#/lib/offices.ts";

import { useAction } from "#/routes/_app/sedes/-shared.tsx";
import type { ActionResult } from "#/routes/_app/sedes/-shared.tsx";

// The room form's fields: the room update schema without the id it is sent with.
const roomFieldsSchema = roomUpdateSchema.omit({ roomId: true });
type RoomFields = z.input<typeof roomFieldsSchema>;

const fieldMessages: Record<keyof RoomFields, string> = {
  name: "Ingresá el nombre del consultorio.",
  capacity: "La capacidad tiene que ser un número entero entre 1 y 100.",
};

export function RoomForm(props: {
  officeId: string;
  title: string;
  description?: string;
  initial: RoomFields;
  submitLabel: string;
  onSubmit: (fields: RoomFields) => Promise<ActionResult>;
}) {
  const { initial, officeId } = props;
  const page = useFormPage({ to: "/sedes/$officeId", params: { officeId } });
  const action = useAction();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = roomFieldsSchema.safeParse({
      name: form.get("name"),
      capacity: Number(form.get("capacity")),
    });
    if (!fields.success) {
      action.setError(fieldMessage(fieldMessages, fields.error));
      return;
    }
    if (await action.save(() => props.onSubmit(fields.data))) {
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
      <NameField idPrefix="room" initial={initial.name} />
      <Field>
        <FieldLabel htmlFor="room-capacity">Capacidad (profesionales a la vez)</FieldLabel>
        <Input
          id="room-capacity"
          name="capacity"
          type="number"
          min={1}
          max={100}
          step={1}
          defaultValue={initial.capacity}
          required
        />
      </Field>
    </ActionFormPage>
  );
}
