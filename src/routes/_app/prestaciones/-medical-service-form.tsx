import { useFormAction } from "#/components/admin-form.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import type { RecordHeader } from "#/components/form-page.tsx";
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
  creates?: boolean;
  /** On an edit: the record's status and actions. */
  record?: RecordHeader;
  onSubmit: (fields: MedicalServiceFields) => Promise<ActionResult>;
}) {
  const { initial, practitionerId, onSubmit, ...shown } = props;
  const page = useFormPage({ to: "/prestaciones/$practitionerId", params: { practitionerId } });
  const action = useFormAction(refusalMessages);

  const form = useAppForm({
    defaultValues: { name: initial.name, durationMinutes: String(initial.durationMinutes) },
    onSubmit: async ({ value }) => {
      const fields = fieldsSchema.safeParse({
        ...value,
        durationMinutes: Number(value.durationMinutes),
      });
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
      <form.AppField name="durationMinutes">
        {(field) => (
          <field.TextField
            label="Duración (minutos)"
            type="number"
            min={1}
            max={720}
            step={1}
            required
          />
        )}
      </form.AppField>
    </ActionFormPage>
  );
}
