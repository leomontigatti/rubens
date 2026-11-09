import { PlusIcon, Trash2Icon } from "lucide-react";

import { useFormAction } from "#/components/admin-form.tsx";
import { FieldProblemText, useAppForm, useFieldProblem } from "#/components/app-form.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import type { RecordHeader } from "#/components/form-page.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "#/components/ui/field.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
  maxMessageHours,
  maxReminders,
  medicalServiceInputSchema,
} from "#/lib/medical-services.ts";
import type { MedicalServiceFields } from "#/lib/medical-services.ts";
import { flattenCareInstructions } from "#/lib/template-filling.ts";

import {
  careInstructionsTooLongMessage,
  refusalMessages,
} from "#/routes/_app/prestaciones/-shared.ts";
import type { RefusalReason } from "#/routes/_app/prestaciones/-shared.ts";

type ActionResult = { ok: true } | { ok: false; reason: RefusalReason };

const fieldMessages: Record<
  keyof MedicalServiceFields | "practitionerId" | "hoursBefore" | "asksToConfirm",
  string
> = {
  practitionerId: "No encontramos ese profesional.",
  name: "Ingresá el nombre.",
  durationMinutes: "La duración tiene que ser de 1 a 720 minutos.",
  bookingConfirmation: "Elegí si se envía la confirmación de turno.",
  reminders: "Dos recordatorios no pueden ir a la misma hora.",
  hoursBefore: `Cada recordatorio va de 1 a ${maxMessageHours} horas antes del turno, en horas enteras.`,
  asksToConfirm: "Elegí si el recordatorio pide confirmar.",
  careInstructions: careInstructionsTooLongMessage,
  followUpHours: `El seguimiento va de 1 a ${maxMessageHours} horas después del turno, en horas enteras, o queda vacío.`,
  rescheduleCutoffHours: `El plazo va de 0 a ${maxMessageHours} horas antes del turno, en horas enteras.`,
};

type FormValues = {
  reminders: ReminderValue[];
  rescheduleCutoffHours: string;
};

/** The copy for a refused field, with its own message for a required one left empty. */
function messageOf(value: FormValues) {
  const fieldMessage = messageIn(fieldMessages);
  return (issue: Parameters<typeof fieldMessage>[0]) => {
    const [key, index] = issue.path;
    if (key === "reminders" && index === undefined && issue.code === "too_big") {
      return `Cada prestación tiene hasta ${maxReminders} recordatorios.`;
    }
    if (
      key === "reminders" &&
      typeof index === "number" &&
      !value.reminders[index]?.hoursBefore.trim()
    ) {
      return "Ingresá las horas antes del turno de cada recordatorio.";
    }
    if (key === "rescheduleCutoffHours" && !value.rescheduleCutoffHours.trim()) {
      return "Ingresá hasta cuántas horas antes del turno se puede reprogramar.";
    }
    return fieldMessage(issue);
  };
}

// A reminder's problems show under the list, whichever row they are in.
const problemNames = { hoursBefore: "reminders", asksToConfirm: "reminders" };

const fieldsSchema = medicalServiceInputSchema.omit({ practitionerId: true });

interface ReminderValue {
  hoursBefore: string;
  asksToConfirm: boolean;
}

export function MedicalServiceForm(props: {
  practitionerId: string;
  title: string;
  description?: string;
  initial: MedicalServiceFields;
  /** The longest care instructions the organization's template has room for. */
  careInstructionsMaxLength: number;
  submitLabel: string;
  creates?: boolean;
  /** On an edit: the record's status and actions. */
  record?: RecordHeader;
  onSubmit: (fields: MedicalServiceFields) => Promise<ActionResult>;
}) {
  const { initial, practitionerId, careInstructionsMaxLength, onSubmit, ...shown } = props;
  const page = useFormPage({ to: "/prestaciones/$practitionerId", params: { practitionerId } });
  const action = useFormAction(refusalMessages, { careInstructionsTooLong: "careInstructions" });

  const form = useAppForm({
    defaultValues: {
      name: initial.name,
      durationMinutes: String(initial.durationMinutes),
      bookingConfirmation: initial.bookingConfirmation ?? true,
      reminders: (initial.reminders ?? []).map((reminder): ReminderValue => ({
        hoursBefore: String(reminder.hoursBefore),
        asksToConfirm: reminder.asksToConfirm,
      })),
      careInstructions: initial.careInstructions ?? "",
      followUpHours: initial.followUpHours == null ? "" : String(initial.followUpHours),
      rescheduleCutoffHours: String(initial.rescheduleCutoffHours ?? 24),
    },
    onSubmit: async ({ value }) => {
      const fields = fieldsSchema.safeParse({
        ...value,
        durationMinutes: Number(value.durationMinutes),
        reminders: value.reminders.map((reminder) => ({
          hoursBefore: hoursOf(reminder.hoursBefore),
          asksToConfirm: reminder.asksToConfirm,
        })),
        followUpHours: value.followUpHours.trim() ? hoursOf(value.followUpHours) : null,
        rescheduleCutoffHours: hoursOf(value.rescheduleCutoffHours),
      });
      if (!fields.success) {
        page.showProblems(fieldProblems(fields.error.issues, messageOf(value), problemNames));
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
      <FieldSet>
        <FieldLegend>Mensajes al paciente</FieldLegend>
        <FieldDescription>Se envían por WhatsApp a los pacientes que lo aceptan.</FieldDescription>
        <FieldGroup>
          <form.AppField name="bookingConfirmation">
            {(field) => <field.CheckboxField label="Enviar confirmación de turno" />}
          </form.AppField>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(submitting) => (
              <form.Field name="reminders" mode="array">
                {(list) => (
                  <RemindersField
                    reminders={list.state.value}
                    submitting={submitting}
                    onAdd={() => list.pushValue({ hoursBefore: "", asksToConfirm: true })}
                    onRemove={(index) => list.removeValue(index)}
                    onChange={(index, reminder) => list.replaceValue(index, reminder)}
                  />
                )}
              </form.Field>
            )}
          </form.Subscribe>
          <form.AppField name="careInstructions">
            {(field) => (
              <field.TextareaField
                label="Indicaciones"
                hint={`Se envían cuando el turno se marca como atendido. Hasta ${careInstructionsMaxLength} caracteres; cada salto de línea cuenta como dos. Vacío: no se envían.`}
                preview={<SentAsOneLine text={field.state.value} />}
              />
            )}
          </form.AppField>
          <form.AppField name="followUpHours">
            {(field) => (
              <field.TextField
                label="Seguimiento (horas después del turno)"
                hint="Se le pregunta al paciente cómo se siente. Vacío: no se envía."
                type="number"
                min={1}
                max={maxMessageHours}
                step={1}
                narrow
              />
            )}
          </form.AppField>
          <form.AppField name="rescheduleCutoffHours">
            {(field) => (
              <field.TextField
                label="Reprogramar hasta (horas antes del turno)"
                hint="Hasta cuándo el paciente puede mover su turno con el asistente."
                type="number"
                min={0}
                max={maxMessageHours}
                step={1}
                required
                narrow
              />
            )}
          </form.AppField>
        </FieldGroup>
      </FieldSet>
    </ActionFormPage>
  );
}

/**
 * The care instructions as patients read them, when sending changes them:
 * WhatsApp takes them on one line, each line break joined as `; ` (#162).
 */
function SentAsOneLine(props: { text: string }) {
  const sent = flattenCareInstructions(props.text);
  if (sent === props.text.trim()) {
    return null;
  }
  return (
    <FieldDescription>
      Los pacientes las reciben en una línea: <span className="text-foreground">{sent}</span>
    </FieldDescription>
  );
}

/** Whole hours as typed; anything else is left for the schema to refuse. */
function hoursOf(text: string) {
  return text.trim() === "" ? Number.NaN : Number(text);
}

function RemindersField(props: {
  reminders: ReminderValue[];
  /** The form's fieldset disables the native inputs while saving, not `Checkbox`. */
  submitting: boolean;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChange: (index: number, reminder: ReminderValue) => void;
}) {
  const { reminders, submitting, onAdd, onRemove, onChange } = props;
  const { problem, errorId, invalid } = useFieldProblem("reminders");
  return (
    <FieldSet>
      <FieldLegend variant="label">Recordatorios</FieldLegend>
      <FieldDescription>
        Antes del turno. Si pide confirmar, el paciente responde si va a asistir.
      </FieldDescription>
      {reminders.map((reminder, index) => {
        const hoursId = `reminders-${index}-hours`;
        const confirmId = `reminders-${index}-confirm`;
        return (
          <div key={index} className="flex flex-wrap items-end gap-4">
            <Field className="w-auto" data-invalid={invalid}>
              <FieldLabel htmlFor={hoursId}>Horas antes</FieldLabel>
              <Input
                id={hoursId}
                type="number"
                min={1}
                max={maxMessageHours}
                step={1}
                className="w-32 max-w-32"
                value={reminder.hoursBefore}
                onChange={(event) =>
                  onChange(index, { ...reminder, hoursBefore: event.target.value })
                }
                aria-invalid={invalid}
                aria-describedby={errorId}
              />
            </Field>
            <Field orientation="horizontal" className="h-9 w-fit">
              <Checkbox
                id={confirmId}
                checked={reminder.asksToConfirm}
                disabled={submitting}
                onCheckedChange={(checked) =>
                  onChange(index, { ...reminder, asksToConfirm: checked })
                }
              />
              <FieldLabel htmlFor={confirmId}>Pide confirmar</FieldLabel>
            </Field>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mb-0.5"
              aria-label={`Quitar el recordatorio de ${reminder.hoursBefore || "?"} horas`}
              onClick={() => onRemove(index)}
            >
              <Trash2Icon className="text-destructive" aria-hidden />
            </Button>
          </div>
        );
      })}
      <FieldProblemText id={errorId}>{problem}</FieldProblemText>
      <div>
        <Button type="button" variant="outline" onClick={onAdd}>
          <PlusIcon data-icon="inline-start" aria-hidden />
          Agregar recordatorio
        </Button>
      </div>
    </FieldSet>
  );
}
