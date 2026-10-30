import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type * as z from "zod";

import { ErrorAlert, FormActions, useFormAction } from "#/components/admin-form.tsx";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import { rangeEntryLabel } from "#/lib/time-ranges.ts";
import type { RangeEntry } from "#/lib/time-ranges.ts";

// The pieces the time-off and closure screens share: a form whose fields say
// when (whole days or a range of hours), and a list item with edit and delete.

type Kind = RangeEntry["kind"];

type Outcome<R extends string> = { ok: true } | { ok: false; reason: R };

/** The entry the fields hold, unchecked: the schema decides whether it is one. */
export function readRangeEntry(form: FormData): unknown {
  if (form.get("kind") === "hours") {
    return { kind: "hours", start: form.get("start"), end: form.get("end") };
  }
  return { kind: "days", firstDate: form.get("firstDate"), lastDate: form.get("lastDate") };
}

type EntryField = "practitionerId" | "officeId" | "firstDate" | "lastDate" | "start" | "end";

const fieldMessages: Record<EntryField, string> = {
  practitionerId: "Elegí un profesional.",
  officeId: "Elegí una sede.",
  firstDate: "Ingresá el primer día.",
  lastDate: "El último día no puede ser anterior al primero.",
  start: "Ingresá el inicio.",
  end: "El fin tiene que ser posterior al inicio.",
};

/** The copy for the first field a time-off or closure schema refused. */
function entryErrorMessage(error: z.ZodError): string {
  const field = error.issues[0]?.path.at(-1);
  return typeof field === "string" && Object.hasOwn(fieldMessages, field)
    ? fieldMessages[field as EntryField]
    : "Revisá los datos ingresados.";
}

/**
 * A time-off or closure form: `children` are the fields before the range.
 * `onSubmit` returns the server call, or the validation error that stopped it.
 */
export function EntryForm<R extends string>(props: {
  idPrefix: string;
  initial: RangeEntry | null;
  submitLabel: string;
  messages: Record<R, string>;
  children?: ReactNode;
  onSubmit: (form: FormData) => Promise<Outcome<R>> | z.ZodError;
  onDone: () => void;
}) {
  const action = useFormAction(props.messages);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = props.onSubmit(new FormData(event.currentTarget));
    if (!(submitted instanceof Promise)) {
      action.setError(entryErrorMessage(submitted));
      return;
    }
    if (await action.run(() => submitted)) {
      props.onDone();
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <ErrorAlert message={action.error} />
      {props.children}
      <RangeEntryFields idPrefix={props.idPrefix} initial={props.initial} />
      <FormActions
        pending={action.pending}
        submitLabel={props.submitLabel}
        onCancel={props.onDone}
      />
    </form>
  );
}

/** A time off or closure in its list, with edit and delete for those who may. */
export function EntryItem<R extends string>(props: {
  title: string;
  deleteQuestion: string;
  entry: RangeEntry;
  canEdit: boolean;
  messages: Record<R, string>;
  onDelete: () => Promise<Outcome<R>>;
  renderEdit: (close: () => void) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const remove = useFormAction(props.messages);
  const [confirming, setConfirming] = useState(false);

  return (
    <li>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="font-medium">{props.title}</span>
              <span className="text-muted-foreground text-sm">{rangeEntryLabel(props.entry)}</span>
            </div>
            {props.canEdit && !editing && (
              <div className="flex flex-col items-end gap-2">
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                    Editar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={remove.pending}
                    onClick={() => setConfirming(true)}
                  >
                    Eliminar
                  </Button>
                </div>
                <ErrorAlert message={remove.error} />
                <ConfirmDialog
                  open={confirming}
                  onOpenChange={setConfirming}
                  title={props.deleteQuestion}
                  description="Esto no se puede deshacer."
                  confirmLabel="Eliminar"
                  onConfirm={() => void remove.run(props.onDelete)}
                />
              </div>
            )}
          </div>
          {editing && props.renderEdit(() => setEditing(false))}
        </CardContent>
      </Card>
    </li>
  );
}

/** Each kind's two inputs: their input type, and each field's name and label. */
const kindFields = {
  days: {
    type: "date",
    fields: [
      ["firstDate", "Desde"],
      ["lastDate", "Hasta (inclusive)"],
    ],
  },
  hours: {
    type: "datetime-local",
    fields: [
      ["start", "Inicio"],
      ["end", "Fin"],
    ],
  },
} as const;

/** The values `initial` gives the fields of `kind`: none when it is of the other kind. */
function valuesFor(initial: RangeEntry | null, kind: Kind): Partial<Record<string, string>> {
  return initial?.kind === kind ? initial : {};
}

function RangeEntryFields(props: { idPrefix: string; initial: RangeEntry | null }) {
  const { idPrefix, initial } = props;
  const [kind, setKind] = useState<Kind>(initial === null ? "days" : initial.kind);
  const values = valuesFor(initial, kind);
  const { type, fields } = kindFields[kind];

  return (
    <div className="flex flex-col gap-4">
      <Field id={`${idPrefix}-kind`} label="Duración">
        <NativeSelect
          id={`${idPrefix}-kind`}
          name="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as Kind)}
        >
          <NativeSelectOption value="days">Días completos</NativeSelectOption>
          <NativeSelectOption value="hours">Por horas</NativeSelectOption>
        </NativeSelect>
      </Field>
      <div className="flex flex-wrap gap-4">
        {fields.map(([name, label]) => (
          <Field key={name} id={`${idPrefix}-${name}`} label={label}>
            <Input
              id={`${idPrefix}-${name}`}
              name={name}
              type={type}
              defaultValue={values[name]}
              required
            />
          </Field>
        ))}
      </div>
    </div>
  );
}

function Field(props: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      {props.children}
    </div>
  );
}
