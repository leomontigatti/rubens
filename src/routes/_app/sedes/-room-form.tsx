import type * as z from "zod";

import { useAppForm } from "#/components/app-form.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import type { RecordHeader } from "#/components/form-page.tsx";
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
  /** On an edit: the record's status and actions. */
  record?: RecordHeader;
  onSubmit: (fields: RoomFields) => Promise<ActionResult>;
}) {
  const { initial, officeId, onSubmit, ...shown } = props;
  const page = useFormPage({ to: "/sedes/$officeId", params: { officeId } });
  const action = useAction();

  const form = useAppForm({
    defaultValues: { name: initial.name, capacity: String(initial.capacity) },
    onSubmit: async ({ value }) => {
      const fields = roomFieldsSchema.safeParse({ ...value, capacity: Number(value.capacity) });
      if (!fields.success) {
        page.showProblems(fieldProblems(fields.error.issues, messageIn(fieldMessages)));
        return;
      }
      if (await action.save(() => onSubmit(fields.data))) {
        page.leave();
      }
    },
  });

  return (
    <ActionFormPage page={page} form={form} action={action} {...shown}>
      <form.AppField name="name">
        {(field) => <field.TextField label="Nombre" required />}
      </form.AppField>
      <form.AppField name="capacity">
        {(field) => (
          <field.TextField
            label="Capacidad (profesionales a la vez)"
            type="number"
            min={1}
            max={100}
            step={1}
            required
          />
        )}
      </form.AppField>
    </ActionFormPage>
  );
}
