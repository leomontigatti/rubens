import { useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { ErrorAlert } from "#/components/admin-form.tsx";
import { FormGrid } from "#/components/app-form.tsx";
import { FieldIdPrefixContext, FormProblemsContext } from "#/components/field-problem.tsx";
import type { FieldProblem } from "#/components/form-problems.ts";
import { Button } from "#/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { useFocusProblem } from "#/hooks/use-focus-problem.ts";

// The exception to a form on a page of its own (style guide, Form dialogs): a
// small record that lives in its parent's list, created and edited over it.

/** What `FormDialog` needs of `useAppForm`'s form. */
interface DialogForm {
  handleSubmit: () => Promise<unknown>;
  reset: () => void;
}

/** A question the dialog asks in place of its form, such as `useDeactivation`'s. */
export interface DialogQuestion {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** What `FormDialog` needs of `useFormAction`. */
interface DialogAction {
  pending: boolean;
  error: string | null;
  errorField: string;
  setError: (error: string | null) => void;
}

/**
 * Whether the dialog is open and what its last submit refused before calling
 * the server; `showProblems` is the form's `onSubmit`'s, like a form page's.
 */
export function useFormDialog() {
  const [open, setOpen] = useState(false);
  const [problems, setProblems] = useState<FieldProblem[]>([]);
  const [problemsShown, setProblemsShown] = useState(0);
  return {
    open,
    problems,
    problemsShown,
    // Each opening starts without the last one's refusals, however that one closed.
    show() {
      setProblems([]);
      setOpen(true);
    },
    hide() {
      setProblems([]);
      setOpen(false);
    },
    setOpen,
    showProblems(refused: FieldProblem[]) {
      setProblems(refused);
      setProblemsShown((shown) => shown + 1);
    },
    clearProblems: () => setProblems([]),
  };
}

export type FormDialogControl = ReturnType<typeof useFormDialog>;

/**
 * A create or an edit in a dialog over the list it belongs to: the fields in
 * one column, a refusal above them or under the field it names, `aside` (a
 * record's `Archivar`) on the footer's left, `Cancelar` and the submit on its
 * right. Closing it, by `Cancelar`, Escape or the close button, drops what it
 * holds; a click outside does not close it.
 */
export function FormDialog(props: {
  dialog: FormDialogControl;
  form: DialogForm;
  action: DialogAction;
  title: ReactNode;
  description: string;
  submitLabel: string;
  aside?: ReactNode;
  /**
   * Asked in place of the form, never in a second dialog over it: `Cancelar`
   * (or Escape) goes back to the form as it was left.
   */
  question?: DialogQuestion | null;
  children: ReactNode;
}) {
  const { dialog, form, action, question } = props;
  const content = useRef<HTMLFormElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  const problems = dialogProblems(dialog, action);
  const general = problems.find((problem) => !problem.field);
  const { problemsShown } = dialog;
  const idPrefix = useId();

  useFocusProblem(content, alert, [problemsShown, action.error]);

  function change(open: boolean) {
    if (!open && question) {
      question.onCancel();
      return;
    }
    if (!open) {
      form.reset();
      dialog.clearProblems();
      action.setError(null);
    }
    dialog.setOpen(open);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dialog.clearProblems();
    action.setError(null);
    void form.handleSubmit();
  }

  return (
    <Dialog open={dialog.open} onOpenChange={change} disablePointerDismissal>
      <DialogContent>
        {question && <QuestionContent question={question} pending={action.pending} />}
        {/* Hidden, not unmounted, while a question is asked: what was typed stays. */}
        <form
          ref={content}
          method="post"
          noValidate
          onSubmit={submit}
          className={question ? "hidden" : "contents"}
        >
          <DialogHeader>
            <DialogTitle>
              <span className="flex flex-wrap items-center gap-2">{props.title}</span>
            </DialogTitle>
            <DialogDescription>{props.description}</DialogDescription>
          </DialogHeader>
          {general && (
            <div ref={alert} tabIndex={-1} className="outline-none">
              <ErrorAlert message={general.message} />
            </div>
          )}
          <FieldIdPrefixContext.Provider value={`${idPrefix}-`}>
            <FormProblemsContext.Provider value={problems}>
              <FormGrid disabled={action.pending}>{props.children}</FormGrid>
            </FormProblemsContext.Provider>
          </FieldIdPrefixContext.Provider>
          <FormFooter
            aside={props.aside}
            pending={action.pending}
            submitLabel={props.submitLabel}
            onCancel={() => change(false)}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** What the last submit refused: the checks before the server, then the server's refusal. */
function dialogProblems(dialog: FormDialogControl, action: DialogAction): FieldProblem[] {
  if (!action.error) {
    return dialog.problems;
  }
  return [...dialog.problems, { field: action.errorField, message: action.error }];
}

/** The form's footer: `aside` on the left, `Cancelar` and the submit on the right. */
function FormFooter(props: {
  aside?: ReactNode;
  pending: boolean;
  submitLabel: string;
  onCancel: () => void;
}) {
  return (
    <DialogFooter className="items-center">
      {props.aside && <div className="mr-auto">{props.aside}</div>}
      <Button type="button" variant="outline" disabled={props.pending} onClick={props.onCancel}>
        Cancelar
      </Button>
      <Button type="submit" disabled={props.pending}>
        {props.pending && <Spinner data-icon="inline-start" aria-hidden />}
        {props.submitLabel}
      </Button>
    </DialogFooter>
  );
}

/** The question in place of the form, with `Cancelar` back to it. */
function QuestionContent(props: { question: DialogQuestion; pending: boolean }) {
  const { question } = props;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{question.title}</DialogTitle>
        <DialogDescription>{question.description}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" disabled={props.pending} onClick={question.onCancel}>
          Cancelar
        </Button>
        <Button variant="destructive" disabled={props.pending} onClick={question.onConfirm}>
          {question.confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
