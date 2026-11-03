import type { NavigateOptions } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type * as z from "zod";

import { ErrorAlert, useFormAction } from "#/components/admin-form.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { NativeSelectOption } from "#/components/ui/native-select.tsx";
import { rangeEntryLabel } from "#/lib/time-ranges.ts";
import type { RangeEntry } from "#/lib/time-ranges.ts";

// The pieces the time-off and closure screens share: a form whose fields say
// when (whole days or a range of hours), and a list item with edit and delete.

type Kind = RangeEntry["kind"];

type Outcome<R extends string> = { ok: true } | { ok: false; reason: R };

/** What the form holds; `owner` is who or where the entry is for, when the form asks. */
interface EntryValues {
  owner: string;
  kind: Kind;
  firstDate: string;
  lastDate: string;
  start: string;
  end: string;
}

/** The entry the fields hold, unchecked: the schema decides whether it is one. */
export function readRangeEntry(values: EntryValues): unknown {
  if (values.kind === "hours") {
    return { kind: "hours", start: values.start, end: values.end };
  }
  return { kind: "days", firstDate: values.firstDate, lastDate: values.lastDate };
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

/** The form holds who or where the entry is for in one field. */
const entryFieldNames = { practitionerId: "owner", officeId: "owner" };

/** What the form opens with: the entry's fields, and none for the other kind. */
function entryValues(initial: RangeEntry | null, owner: string): EntryValues {
  const empty = { owner, firstDate: "", lastDate: "", start: "", end: "" };
  return initial ? { ...empty, ...initial } : { ...empty, kind: "days" };
}

/**
 * A time-off or closure form on its page. `owner`, when given, is the field
 * before the range. `onSubmit` returns the server call, or the validation error
 * that stopped it.
 */
export function EntryForm<R extends string>(props: {
  back: NavigateOptions;
  title: string;
  description?: string;
  initial: RangeEntry | null;
  owner?: { label: string; initial: string; required?: boolean; options: ReactNode };
  submitLabel: string;
  messages: Record<R, string>;
  onSubmit: (values: EntryValues) => Promise<Outcome<R>> | z.ZodError;
}) {
  const { owner } = props;
  const page = useFormPage(props.back);
  const action = useFormAction(props.messages);
  const form = useAppForm({
    defaultValues: entryValues(props.initial, owner?.initial ?? ""),
    onSubmit: async ({ value }) => {
      const submitted = props.onSubmit(value);
      if (!(submitted instanceof Promise)) {
        page.showProblems(
          fieldProblems(submitted.issues, messageIn(fieldMessages), entryFieldNames),
        );
        return;
      }
      if (await action.save(() => submitted)) {
        page.leave();
      }
    },
  });

  return (
    <ActionFormPage
      page={page}
      form={form}
      title={props.title}
      description={props.description}
      submitLabel={props.submitLabel}
      action={action}
    >
      {owner && (
        <form.AppField name="owner">
          {(field) => (
            <field.SelectField label={owner.label} required={owner.required}>
              {owner.options}
            </field.SelectField>
          )}
        </form.AppField>
      )}
      <div className="flex flex-col gap-4">
        <form.AppField name="kind">
          {(field) => (
            <field.SelectField label="Duración">
              <NativeSelectOption value="days">Días completos</NativeSelectOption>
              <NativeSelectOption value="hours">Por horas</NativeSelectOption>
            </field.SelectField>
          )}
        </form.AppField>
        <form.Subscribe selector={(state) => state.values.kind}>
          {(kind) => {
            const { type, fields } = kindFields[kind];
            return (
              <div className="flex flex-wrap gap-4">
                {fields.map(([name, label]) => (
                  <form.AppField key={name} name={name}>
                    {(field) => <field.TextField label={label} type={type} inline required />}
                  </form.AppField>
                ))}
              </div>
            );
          }}
        </form.Subscribe>
      </div>
    </ActionFormPage>
  );
}

/** A time off or closure in its list, with edit and delete for those who may. */
export function EntryItem<R extends string>(props: {
  title: string;
  deleteQuestion: string;
  deleteNotice: string;
  entry: RangeEntry;
  canEdit: boolean;
  messages: Record<R, string>;
  onDelete: () => Promise<Outcome<R>>;
  /** The `Link` to the entry's edit page. */
  editLink: ReactElement;
}) {
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
            {props.canEdit && (
              <div className="flex flex-col items-end gap-2">
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" nativeButton={false} render={props.editLink}>
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
                  description={props.deleteNotice}
                  confirmLabel="Eliminar"
                  onConfirm={() => void remove.run(props.onDelete)}
                />
              </div>
            )}
          </div>
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
