import type { NavigateOptions } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";
import type * as z from "zod";

import { useFormAction } from "#/components/admin-form.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import type { RecordHeader } from "#/components/form-page.tsx";
import { Button } from "#/components/ui/button.tsx";
import { NativeSelectOption } from "#/components/ui/native-select.tsx";
import type { AffectsAppointments, Notice, RangeEntry } from "#/lib/time-ranges.ts";

// The pieces the time-off and closure screens share: a form whose fields say
// when (whole days or a range of hours), the question a save asks when it
// sends appointments to the "to reschedule" list, and the delete on its edit
// page.

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
  lastDate: "Ingresá el último día.",
  start: "Ingresá el inicio.",
  end: "Ingresá el fin.",
};

/** The copy for the ranges the schemas refuse, by their issue's message. */
const rangeMessages: Record<string, string> = {
  lastBeforeFirst: "El último día no puede ser anterior al primero.",
  endBeforeStart: "El fin tiene que ser posterior al inicio.",
};

const entryMessage = (issue: z.core.$ZodIssue) =>
  rangeMessages[issue.message] ?? messageIn(fieldMessages)(issue);

/** The form holds who or where the entry is for in one field. */
const entryFieldNames = { practitionerId: "owner", officeId: "owner" };

/** What the form opens with: the entry's fields, and none for the other kind. */
function entryValues(initial: RangeEntry | null, owner: string): EntryValues {
  const empty = { owner, firstDate: "", lastDate: "", start: "", end: "" };
  return initial ? { ...empty, ...initial } : { ...empty, kind: "days" };
}

interface Deletion<R extends string> {
  question: string;
  notice: string;
  onDelete: () => Promise<Outcome<R>>;
}

/** How the question names what is saved. */
const subjects = { timeOff: "Esta licencia", closure: "Este cierre" };

function affectedNotice(subject: keyof typeof subjects, affected: number): string {
  const appointments = affected === 1 ? "1 turno" : `${affected} turnos`;
  return `${subjects[subject]} deja ${appointments} fuera de horario. Pasan a Turnos a reprogramar, se avise o no.`;
}

/**
 * A time-off or closure form on its page. `owner`, when given, is the field
 * before the range. `onSubmit` returns the server call with `notice`, or the
 * validation error that stopped it. A save the server refuses for the
 * appointments it sends to the list asks whether to tell the patients, with
 * the count, and submits again with the answer: asking again when the count
 * changed meanwhile.
 */
export function EntryForm<R extends string>(props: {
  back: NavigateOptions;
  title: string;
  description?: string;
  subject: keyof typeof subjects;
  initial: RangeEntry | null;
  owner?: { label: string; initial: string; required?: boolean; options: ReactNode };
  submitLabel: string;
  creates?: boolean;
  messages: Record<R, string>;
  /** On an edit: the entry's delete, its only page being this one. */
  deletion?: Deletion<R>;
  onSubmit: (
    values: EntryValues,
    notice: Notice,
  ) => Promise<Outcome<R> | AffectsAppointments> | z.ZodError;
}) {
  const { owner } = props;
  const page = useFormPage(props.back);
  const action = useFormAction(props.messages);
  const record = useDeletion(props.deletion, props.messages, () => page.leave());
  // Kept once the dialog closes, so its copy stays while it fades out.
  const [asked, setAsked] = useState<{ values: EntryValues; affected: number } | null>(null);
  const [asking, setAsking] = useState(false);

  async function save(values: EntryValues, notice: Notice) {
    const submitted = props.onSubmit(values, notice);
    if (!(submitted instanceof Promise)) {
      page.showProblems(fieldProblems(submitted.issues, entryMessage, entryFieldNames));
      return;
    }
    let affected = 0;
    const saved = await action.save(async () => {
      const result = await submitted;
      if (!result.ok && result.reason === "affectsAppointments") {
        affected = (result as AffectsAppointments).affected;
        return { ok: true };
      }
      return result as Outcome<R>;
    });
    if (affected > 0) {
      setAsked({ values, affected });
      setAsking(true);
    } else if (saved) {
      page.leave();
    }
  }

  const answer = (tellPatients: boolean) => {
    if (asked) {
      void save(asked.values, { tellPatients, affected: asked.affected });
    }
  };

  const form = useAppForm({
    defaultValues: entryValues(props.initial, owner?.initial ?? ""),
    onSubmit: ({ value }) => save(value, {}),
  });

  return (
    <ActionFormPage
      page={page}
      form={form}
      title={props.title}
      description={props.description}
      submitLabel={props.submitLabel}
      creates={props.creates}
      record={record}
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
      <form.AppField name="kind">
        {(field) => (
          <field.SelectField label="Duración" startsRow>
            <NativeSelectOption value="days">Días completos</NativeSelectOption>
            <NativeSelectOption value="hours">Por horas</NativeSelectOption>
          </field.SelectField>
        )}
      </form.AppField>
      <form.Subscribe selector={(state) => state.values.kind}>
        {(kind) => {
          const { type, fields } = kindFields[kind];
          return fields.map(([name, label]) => (
            <form.AppField key={name} name={name}>
              {(field) => <field.TextField label={label} type={type} required />}
            </form.AppField>
          ));
        }}
      </form.Subscribe>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="¿Avisar a los pacientes por WhatsApp?"
        description={asked ? affectedNotice(props.subject, asked.affected) : ""}
        confirmLabel="Avisar por WhatsApp"
        onConfirm={() => answer(true)}
        alternative={{ label: "Guardar sin avisar", onSelect: () => answer(false) }}
      />
    </ActionFormPage>
  );
}

/** The delete on an entry's edit page: it asks first, then leaves for the list. */
function useDeletion<R extends string>(
  deletion: Deletion<R> | undefined,
  messages: Record<R, string>,
  leave: () => void,
): RecordHeader | undefined {
  const remove = useFormAction(messages);
  const [confirming, setConfirming] = useState(false);
  if (!deletion) {
    return undefined;
  }
  return {
    actions: (busy) => (
      <>
        <Button
          variant="outline"
          disabled={remove.pending || busy}
          onClick={() => setConfirming(true)}
        >
          Eliminar
        </Button>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={deletion.question}
          description={deletion.notice}
          confirmLabel="Eliminar"
          onConfirm={() =>
            void remove.save(deletion.onDelete).then((deleted) => deleted && leave())
          }
        />
      </>
    ),
    error: remove.error,
  };
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
