import type { NavigateOptions } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";
import type * as z from "zod";

import { useFormAction } from "#/components/admin-form.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { entryFieldNames, entryValues } from "#/components/range-entry-values.ts";
import type { EntryValues } from "#/components/range-entry-values.ts";
import { answering, questionAfter, questionText } from "#/components/range-entry-question.ts";
import type { NoticeQuestion, QuestionSubject } from "#/components/range-entry-question.ts";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import type { RecordHeader } from "#/components/form-page.tsx";
import { Button } from "#/components/ui/button.tsx";
import { NativeSelectOption } from "#/components/ui/native-select.tsx";
import type { AffectsAppointments, Notice, RangeEntry } from "#/lib/time-ranges.ts";

// The pieces the time-off and closure screens share: a form whose fields say
// when (whole days or a range of hours), the question a save asks when it
// sends appointments to the "to reschedule" list, and the delete on its edit
// page.

type Outcome<R extends string> = { ok: true } | { ok: false; reason: R };

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

interface Deletion<R extends string> {
  question: string;
  notice: string;
  onDelete: () => Promise<Outcome<R>>;
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
  subject: QuestionSubject;
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
  ) => Promise<Outcome<NoInfer<R>> | AffectsAppointments> | z.ZodError;
}) {
  const { owner } = props;
  const page = useFormPage(props.back);
  const action = useFormAction(props.messages);
  const record = useDeletion(props.deletion, props.messages, () => page.leave());
  // Kept once the dialog closes, so its copy stays while it fades out. It
  // belongs to the page that asked: the route renders other records too.
  const [question, setQuestion] = useState<(NoticeQuestion<EntryValues> & { page: string }) | null>(
    null,
  );
  const [asking, setAsking] = useState(false);

  async function save(values: EntryValues, notice: Notice) {
    const submitted = props.onSubmit(values, notice);
    if (!(submitted instanceof Promise)) {
      page.showProblems(fieldProblems(submitted.issues, entryMessage, entryFieldNames(values)));
      return;
    }
    let refused: NoticeQuestion<EntryValues> | null = null;
    const saved = await action.save(async () => {
      const result = await submitted;
      refused = questionAfter(values, result);
      return refused ? { ok: true } : (result as Outcome<R>);
    });
    if (refused) {
      // A save that ends after the user left asks nothing: nothing was saved.
      if (!page.left()) {
        setQuestion({ ...(refused as NoticeQuestion<EntryValues>), page: page.shown });
        setAsking(true);
      }
    } else if (saved) {
      page.leave();
    }
  }

  // Leaving the page drops its question: coming back by history must not answer it.
  if (question && question.page !== page.shown) {
    setQuestion(null);
    setAsking(false);
  }

  const answer = (tellPatients: boolean) => {
    if (question) {
      const again = answering(question, tellPatients);
      void save(again.values, again.notice);
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
        {(kind) =>
          kindFields[kind].map(([name, label, holds], index) => (
            <form.AppField key={name} name={name}>
              {(field) =>
                holds === "date" ? (
                  // A range of hours takes a row of its own: two dates, two times.
                  <field.DateField
                    label={label}
                    startsRow={kind === "hours" && index === 0}
                    required
                  />
                ) : (
                  <field.TimeField label={label} required />
                )
              }
            </form.AppField>
          ))
        }
      </form.Subscribe>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="¿Avisar a los pacientes por WhatsApp?"
        description={question ? questionText(props.subject, question.affected) : ""}
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

/** Each kind's fields: their name, label and whether each holds a date or a time. */
const kindFields = {
  days: [
    ["firstDate", "Desde", "date"],
    ["lastDate", "Hasta (inclusive)", "date"],
  ],
  hours: [
    ["startDate", "Fecha de inicio", "date"],
    ["startTime", "Hora de inicio", "time"],
    ["endDate", "Fecha de fin", "date"],
    ["endTime", "Hora de fin", "time"],
  ],
} as const;
