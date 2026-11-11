import { useFormAction } from "#/components/admin-form.tsx";
import { FormGrid, useAppForm } from "#/components/app-form.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import type { RecordHeader } from "#/components/form-page.tsx";
import { FieldDescription, FieldLegend } from "#/components/ui/field.tsx";
import { medicalServiceInputSchema } from "#/lib/medical-services.ts";
import type { MedicalServiceFields } from "#/lib/medical-services.ts";
import type { Timing } from "#/lib/template-timing.ts";
import { timingLabel } from "#/lib/whatsapp-template-copy.ts";

import { refusalMessages } from "#/routes/_app/prestaciones/-shared.ts";
import type { RefusalReason } from "#/routes/_app/prestaciones/-shared.ts";

type ActionResult = { ok: true } | { ok: false; reason: RefusalReason };

const fieldMessages: Record<keyof MedicalServiceFields | "practitionerId", string> = {
  practitionerId: "No encontramos ese profesional.",
  name: "Ingresá el nombre.",
  durationMinutes: "La duración tiene que ser de 1 a 720 minutos.",
  templateIds: "Elegí plantillas de la lista.",
  rescheduleCutoffHours: "El plazo va de 0 a 720 horas antes del turno, en horas enteras.",
};

/** The copy for a refused field, with its own message for a required one left empty. */
function messageOf(value: { rescheduleCutoffHours: string }) {
  const fieldMessage = messageIn(fieldMessages);
  return (issue: Parameters<typeof fieldMessage>[0]) => {
    if (issue.path[0] === "rescheduleCutoffHours" && !value.rescheduleCutoffHours.trim()) {
      return "Ingresá hasta cuántas horas antes del turno se puede reprogramar.";
    }
    return fieldMessage(issue);
  };
}

const fieldsSchema = medicalServiceInputSchema.omit({ practitionerId: true });

/** One of the organization's templates a medical service can pick. */
export interface PickableTemplate {
  id: string;
  name: string;
  timing: Timing;
}

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
  const action = useFormAction(refusalMessages, { unknownTemplate: "templateIds" });

  const form = useAppForm({
    defaultValues: {
      name: initial.name,
      durationMinutes: String(initial.durationMinutes),
      templateIds: initial.templateIds ?? [],
      rescheduleCutoffHours: String(initial.rescheduleCutoffHours ?? 24),
    },
    onSubmit: async ({ value }) => {
      const fields = fieldsSchema.safeParse({
        ...value,
        durationMinutes: Number(value.durationMinutes),
        rescheduleCutoffHours: hoursOf(value.rescheduleCutoffHours),
      });
      if (!fields.success) {
        page.showProblems(fieldProblems(fields.error.issues, messageOf(value)));
        return;
      }
      if (await action.save(() => onSubmit(fields.data))) {
        page.leave();
      }
    },
  });

  const options = templates.map((one) => ({
    value: one.id,
    label: `${one.name} · ${timingLabel(one.timing)}`,
  }));

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
      <FormGrid>
        <FieldLegend>Mensajes por WhatsApp</FieldLegend>
        <FieldDescription>
          Las plantillas que reciben sus pacientes, si aceptan WhatsApp. Se crean en WhatsApp,
          Plantillas.
        </FieldDescription>
        {options.length > 0 ? (
          <form.AppField name="templateIds">
            {(field) => <field.CheckboxGroupField legend="Plantillas" options={options} />}
          </form.AppField>
        ) : (
          <FieldDescription>Todavía no hay plantillas.</FieldDescription>
        )}
        <form.AppField name="rescheduleCutoffHours">
          {(field) => (
            <field.TextField
              label="Reprogramar hasta (horas antes del turno)"
              hint="Hasta cuándo el paciente puede mover su turno con el asistente."
              type="number"
              min={0}
              max={720}
              step={1}
              required
            />
          )}
        </form.AppField>
      </FormGrid>
    </ActionFormPage>
  );
}

/** Whole hours as typed; anything else is left for the schema to refuse. */
function hoursOf(text: string) {
  return text.trim() === "" ? Number.NaN : Number(text);
}
