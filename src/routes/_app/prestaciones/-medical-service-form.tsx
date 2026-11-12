import { useFormAction } from "#/components/admin-form.tsx";
import { SelectOptions, useAppForm } from "#/components/app-form.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import type { RecordHeader } from "#/components/form-page.tsx";
import { cutoffChoices, durationChoices } from "#/lib/hour-choices.ts";
import { medicalServiceInputSchema } from "#/lib/medical-services.ts";
import type { MedicalServiceFields } from "#/lib/medical-services.ts";

import { refusalMessages, tooManyRemindersText } from "#/routes/_app/prestaciones/-shared.ts";
import type { RefusalReason } from "#/routes/_app/prestaciones/-shared.ts";
import { templateOptions, tooManyReminders } from "#/routes/_app/prestaciones/-template-picks.ts";
import type { PickableTemplate } from "#/routes/_app/prestaciones/-template-picks.ts";

type ActionResult = { ok: true } | { ok: false; reason: RefusalReason };

const fieldMessages: Record<keyof MedicalServiceFields | "practitionerId", string> = {
  practitionerId: "No encontramos ese profesional.",
  name: "Ingresá el nombre.",
  durationMinutes: "Elegí la duración.",
  templateIds: "Elegí plantillas de la lista.",
  rescheduleCutoffHours: "Elegí hasta cuándo se puede reprogramar.",
};

const fieldsSchema = medicalServiceInputSchema.omit({ practitionerId: true });

export function MedicalServiceForm(props: {
  practitionerId: string;
  title: string;
  description?: string;
  initial: MedicalServiceFields;
  /** The organization's own templates, in the order their messages go. */
  templates: PickableTemplate[];
  submitLabel: string;
  creates?: boolean;
  /** On an edit: the record's status and actions. */
  record?: RecordHeader;
  onSubmit: (fields: MedicalServiceFields) => Promise<ActionResult>;
}) {
  const { initial, practitionerId, templates, onSubmit, ...shown } = props;
  const page = useFormPage({ to: "/prestaciones/$practitionerId", params: { practitionerId } });
  const action = useFormAction(refusalMessages, {
    unknownTemplate: "templateIds",
    tooManyReminders: "templateIds",
  });
  const cutoffHours = initial.rescheduleCutoffHours ?? 24;

  const form = useAppForm({
    defaultValues: {
      name: initial.name,
      durationMinutes: String(initial.durationMinutes),
      templateIds: initial.templateIds ?? [],
      rescheduleCutoffHours: String(cutoffHours),
    },
    onSubmit: async ({ value }) => {
      const fields = fieldsSchema.safeParse({
        ...value,
        durationMinutes: Number(value.durationMinutes),
        rescheduleCutoffHours: Number(value.rescheduleCutoffHours),
      });
      if (!fields.success) {
        page.showProblems(fieldProblems(fields.error.issues, messageIn(fieldMessages)));
        return;
      }
      if (tooManyReminders(templates, fields.data.templateIds)) {
        page.showProblems([{ field: "templateIds", message: tooManyRemindersText }]);
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
          <field.SelectField label="Duración" size="quarter" required>
            <SelectOptions options={durationChoices(initial.durationMinutes)} />
          </field.SelectField>
        )}
      </form.AppField>
      <form.AppField name="templateIds">
        {(field) => (
          <field.MultiComboboxField
            label="Mensajes por WhatsApp"
            options={templateOptions(templates, initial.templateIds ?? [])}
            emptyText="No hay plantillas listas para enviar."
            noMatchText={(query) => `Ninguna plantilla lista para enviar coincide con “${query}”.`}
            removeLabel={(name) => `Quitar ${name}`}
          />
        )}
      </form.AppField>
      <form.AppField name="rescheduleCutoffHours">
        {(field) => (
          <field.SelectField
            label="Reprogramar hasta"
            hint="Hasta cuándo el paciente puede mover su turno con el asistente."
            size="quarter"
            startsRow
            required
          >
            <SelectOptions options={cutoffChoices(cutoffHours)} />
          </field.SelectField>
        )}
      </form.AppField>
    </ActionFormPage>
  );
}
