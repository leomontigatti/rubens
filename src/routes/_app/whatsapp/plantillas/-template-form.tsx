import { useStore } from "@tanstack/react-form";
import { useState } from "react";
import type { ReactNode } from "react";

import { useFormAction } from "#/components/admin-form.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { FormPage, useFormPage } from "#/components/form-page.tsx";
import type { RecordHeader } from "#/components/form-page.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import type { FieldProblem } from "#/components/form-problems.ts";
import { Button } from "#/components/ui/button.tsx";
import { timingEntry, timingFromEntry } from "#/lib/template-timing.ts";
import type { Timing } from "#/lib/template-timing.ts";
import type { TemplateVariable } from "#/lib/template-filling.ts";
import { templateCreateSchema, templateVariables } from "#/lib/whatsapp-templates.ts";
import type { TemplateProblem } from "#/lib/whatsapp-templates.ts";

import { maxReminders } from "#/lib/medical-services.ts";
import { problemText, templateRefusalMessages } from "#/lib/whatsapp-template-copy.ts";

import { TemplatePreview } from "#/routes/_app/whatsapp/plantillas/-template-preview.tsx";

// The form a template is written in, for a new one and an edit: for the
// organization's own, its name and when it goes; for every one, its text,
// with the variables it may use as chips, and the preview beside it.

const templateFormRefusals = {
  ...templateRefusalMessages,
  // The body's own problems show under it; this is what an unexpected one says.
  invalidTemplate: "Revisá el texto de la plantilla.",
  metaRefused: "Meta rechazó la plantilla.",
  notFound: "No encontramos esa plantilla.",
  nameTaken: "Ya hay una plantilla con ese nombre.",
  tooManyReminders: `Una prestación que la envía ya tiene ${maxReminders} recordatorios: quitásela en Prestaciones o elegí otro momento.`,
  alreadySubmitting:
    "Esta plantilla ya se está enviando a Meta. Esperá a que termine y volvé a intentar.",
};

type RefusalReason = keyof typeof templateFormRefusals;

/** What the server answered a save, in the form's terms. */
export type TemplateSaveResult =
  | { ok: true }
  | { ok: false; reason: "invalidTemplate"; problems: TemplateProblem[] }
  | { ok: false; reason: "metaRefused"; metaError: { message: string } }
  | { ok: false; reason: Exclude<RefusalReason, "invalidTemplate" | "metaRefused"> };

/** What a save sends: the text, and for the organization's own the name and the timing. */
export interface TemplateValues {
  body: string;
  settings: { name: string; timing: Timing } | null;
}

const whenOptions = [
  { value: "booking", label: "Al dar el turno" },
  { value: "before", label: "Antes del turno" },
  { value: "attended", label: "Al marcar el turno como atendido" },
  { value: "after", label: "Después del turno" },
] as const;

const sendTimeHint =
  "No escribas cuándo se envía (mañana, en 2 horas): usá {{fecha}} y {{hora}}. Sin ¿ ni ¡ de apertura y sin emojis. Hasta 1024 caracteres, sin empezar ni terminar con una variable.";

/** Whether a change of `Trato` changes the text (docs/operations/whatsapp-templates.md § Voice). */
const formOfAddressNotes = {
  fixed:
    "Si cambiás el trato (vos o usted) en Reglas de comunicación, este texto no cambia: editalo acá.",
  follows:
    "Mientras no la envíes a Meta, este texto cambia con el trato (vos o usted) de Reglas de comunicación. Una vez enviada, ya no cambia: editalo acá.",
};

/** The name and timing as the server takes them. */
const settingsSchema = templateCreateSchema.pick({ name: true, timing: true });

const settingsMessages = {
  name: "Ingresá un nombre de hasta 80 caracteres.",
  hours: "Ingresá de 1 hora a 30 días, en números enteros.",
  when: "Elegí cuándo se envía.",
};

/** The refusals that come after an edit stored its name and timing: Meta's, and its settings'. */
const settingsKept: string[] = [
  "metaRefused",
  "alreadySubmitting",
  "connectionFailed",
  "missingAccessToken",
  "missingBusinessAccountId",
];

/** The body's problems, as the one problem under its field. */
function bodyProblem(problems: TemplateProblem[]): FieldProblem[] {
  return [{ field: "body", message: problems.map(problemText).join(" ") }];
}

export function TemplateForm(props: {
  /** `null` for a new template. */
  templateId: string | null;
  /** The name and timing it starts with; `null` for an event template, which has neither. */
  settings: { name: string; timing: Timing } | null;
  body: string;
  /** Fills `{{organizacion}}` in the preview. */
  organizationName: string;
  title: string;
  description?: string;
  submitLabel: (bodyChanged: boolean) => string;
  /** The text of the version at Meta now, against which a change is sent; none for one never sent. */
  sentBody: string | null;
  record?: RecordHeader;
  lead?: ReactNode;
  versionNote?: string;
  /** Whether its text is a default draft never sent, which follows the `Trato`. */
  followsTrato?: boolean;
  save: (values: TemplateValues) => Promise<TemplateSaveResult>;
}) {
  const { templateId, settings, save } = props;
  const page = useFormPage({ to: "/whatsapp/plantillas" });
  const action = useFormAction(templateFormRefusals, {
    nameTaken: "name",
    tooManyReminders: "timing.when",
  });

  // The name and timing stored: a refused edit keeps them, and a discard goes back to them.
  const [stored, setStored] = useState({
    name: settings?.name ?? "",
    timing: timingEntry(settings?.timing ?? { when: "before", hours: 24 }),
  });
  const form = useAppForm({
    defaultValues: { ...stored, body: props.body },
    onSubmit: async ({ value }) => {
      const checked = settingsSchema.safeParse({
        name: value.name,
        timing: timingFromEntry(value.timing),
      });
      if (settings && !checked.success) {
        page.showProblems(
          fieldProblems(checked.error.issues, messageIn(settingsMessages), {
            hours: "timing.amount",
            when: "timing.when",
          }),
        );
        return;
      }
      // What a refusal said beyond its reason, read inside the action.
      const refused: { reason: string | null; metaMessage: string | null } = {
        reason: null,
        metaMessage: null,
      };
      const saved = await action.save(async () => {
        const result = await save({
          body: value.body,
          settings: settings && checked.success ? checked.data : null,
        });
        if (!result.ok && result.reason === "invalidTemplate") {
          page.showProblems(bodyProblem(result.problems));
        }
        if (!result.ok) {
          refused.reason = result.reason;
        }
        if (!result.ok && result.reason === "metaRefused") {
          refused.metaMessage = result.metaError.message;
        }
        return result.ok ? { ok: true } : { ok: false, reason: result.reason };
      });
      if (saved) {
        page.leave();
        return;
      }
      const message = refused.metaMessage
        ? `${templateFormRefusals.metaRefused} ${refused.metaMessage}`
        : refused.reason && templateFormRefusals[refused.reason as RefusalReason];
      // An edit stores the name and timing before it sends the text, so only the text is lost.
      const kept =
        templateId && settings && checked.success && settingsKept.includes(refused.reason!);
      if (message && kept) {
        // As the server stored them: the schema's output, trimmed and in hours.
        setStored({ name: checked.data.name, timing: timingEntry(checked.data.timing) });
        action.setError(`${message} El nombre y cuándo se envía se guardaron.`);
      } else if (refused.metaMessage) {
        action.setError(message);
      }
    },
  });

  const body = useStore(form.store, (state) => state.values.body);
  const when = useStore(form.store, (state) => state.values.timing.when);
  const bodyChanged = body.trim() !== (props.sentBody ?? null);

  function insertVariable(variable: TemplateVariable) {
    const box = document.getElementById("body");
    const text = `{{${variable}}}`;
    if (!(box instanceof HTMLTextAreaElement)) {
      form.setFieldValue("body", `${body}${text}`);
      return;
    }
    const { selectionStart, selectionEnd } = box;
    form.setFieldValue("body", body.slice(0, selectionStart) + text + body.slice(selectionEnd));
    requestAnimationFrame(() => {
      box.focus();
      box.setSelectionRange(selectionStart + text.length, selectionStart + text.length);
    });
  }

  return (
    <FormPage
      page={page}
      form={form}
      title={props.title}
      description={props.description}
      submitLabel={props.submitLabel(bodyChanged)}
      creates={templateId === null}
      pending={action.pending}
      refusals={action.error ? [{ field: action.errorField, message: action.error }] : undefined}
      onClear={() => action.setError(null)}
      record={props.record}
      lead={props.lead}
    >
      {settings && (
        <>
          <form.AppField name="name">
            {(field) => <field.TextField label="Nombre" size="half" required maxLength={80} />}
          </form.AppField>
          <form.AppField name="timing.when">
            {(field) => (
              <field.SelectField label="Cuándo se envía" startsRow required>
                {whenOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </field.SelectField>
            )}
          </form.AppField>
          {(when === "before" || when === "after") && (
            <>
              <form.AppField name="timing.amount">
                {(field) => (
                  <field.TextField
                    label="Cuánto"
                    type="number"
                    min={1}
                    max={720}
                    step={1}
                    required
                  />
                )}
              </form.AppField>
              <form.AppField name="timing.unit">
                {(field) => (
                  <field.SelectField label="Unidad" required>
                    <option value="hours">Horas</option>
                    <option value="days">Días</option>
                  </field.SelectField>
                )}
              </form.AppField>
            </>
          )}
        </>
      )}
      {props.versionNote && <p className="text-muted-foreground text-sm">{props.versionNote}</p>}
      <div className="grid items-start gap-6 lg:grid-cols-5">
        <div className="flex flex-col gap-3 lg:col-span-3">
          <form.AppField name="body">
            {(field) => <field.TextareaField label="Texto" required hint={sendTimeHint} />}
          </form.AppField>
          <VariableChips variables={templateVariables(templateId)} onPick={insertVariable} />
          <p className="text-muted-foreground text-sm">
            {formOfAddressNotes[props.followsTrato ? "follows" : "fixed"]}
          </p>
        </div>
        <div className="lg:col-span-2">
          <TemplatePreview
            templateId={templateId}
            body={body}
            organizationName={props.organizationName}
          />
        </div>
      </div>
    </FormPage>
  );
}

/** The variables the text may use, each a chip that writes it in at the cursor. */
function VariableChips(props: {
  variables: readonly TemplateVariable[];
  onPick: (variable: TemplateVariable) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium" id="variable-chips">
        Variables
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-labelledby="variable-chips">
        {props.variables.map((variable) => (
          <Button
            key={variable}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => props.onPick(variable)}
          >
            {`{{${variable}}}`}
          </Button>
        ))}
      </div>
    </div>
  );
}
