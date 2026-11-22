import { cn } from "cn";
import {
  useBlocker,
  useCanGoBack,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import type { NavigateOptions } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-form";
import type { AnyFormApi } from "@tanstack/react-form";
import { CheckIcon, ChevronLeftIcon, PlusIcon, Undo2Icon } from "lucide-react";
import { useRef, useState } from "react";
import type { FormEvent, ReactElement, ReactNode, Ref } from "react";

import { ErrorAlert } from "#/components/admin-form.tsx";
import { FormGrid } from "#/components/app-form.tsx";
import { FormProblemsContext } from "#/components/field-problem.tsx";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { isStillOn } from "#/components/form-page-location.ts";
import type { FieldProblem } from "#/components/form-problems.ts";
import { AlertStack } from "#/components/alert-stack.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { RecordName } from "#/components/record-transition.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent, CardFooter } from "#/components/ui/card.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { useFocusProblem } from "#/hooks/use-focus-problem.ts";
import { useMountedRef } from "#/hooks/use-mounted-ref.ts";
import { isSessionChanging } from "#/lib/session-change.ts";

/**
 * A form page's way out: `Volver` goes where the browser's back goes, so a list
 * comes back with its filters and page, or to `back` when the page was opened
 * from a link. Leaving with unsaved changes asks first, by any way out: the
 * question is `FormPage`'s, which knows whether the form differs.
 */
export function useFormPage(back: NavigateOptions) {
  const router = useRouter();
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  // The page this render shows: a route reused across records renders each one.
  const shown = useRouterState({
    select: (state) => (state.resolvedLocation ?? state.location).pathname,
  });
  const [version, setVersion] = useState(0);
  const [discarding, setDiscarding] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [problems, setProblems] = useState<FieldProblem[]>([]);
  const [problemsShown, setProblemsShown] = useState(0);
  const released = useRef(false);
  const mounted = useMountedRef();

  function goBack() {
    if (canGoBack) {
      router.history.back();
    } else {
      void navigate(back);
    }
  }

  /**
   * Whether the user left the page this render shows, or is on the way to
   * another: a navigation still loading keeps the form mounted, and so does
   * one to another record of the same route.
   */
  function userLeft() {
    const { location, resolvedLocation } = router.state;
    return !mounted.current || !isStillOn(shown, location, resolvedLocation);
  }

  /** Where going back leads: the page before this one, or `back` when there is none. */
  const previous = () => (canGoBack ? null : back);

  /** Replaces this page with `target`, or returns to the page before it. */
  function exit(target: NavigateOptions | null) {
    if (target) {
      void navigate({ ...target, replace: true });
    } else {
      router.history.back();
    }
  }

  /**
   * Leaves without asking: what is saved, or a way out the form itself offers.
   * A save that ends after the user left, or while they are leaving, moves
   * nobody, and refreshes where they are going. A save calls the `leave` of the
   * render it started from, which knows that render's page: one kept in a ref
   * would take the page the form shows when the save ends.
   * It leaves once: a save and a delete that both succeed go back one page.
   */
  function leave(to?: NavigateOptions) {
    if (userLeft()) {
      void router.invalidate();
      return;
    }
    if (released.current) {
      return;
    }
    released.current = true;
    setLeaving(true);
    exit(to ?? previous());
  }

  return {
    version,
    leaving,
    problems,
    problemsShown,
    /** Shows what the form's check refused, under each field and in the summary. */
    showProblems: (refused: FieldProblem[]) => {
      setProblems(refused);
      setProblemsShown((shown) => shown + 1);
    },
    clearProblems: () => setProblems([]),
    goBack,
    leave,
    /** The page this render shows, and whether the user has left it since. */
    shown,
    left: userLeft,
    /** Whether `leave` has started: the page goes without asking. */
    released: () => released.current,
    discarding,
    askToDiscard: () => setDiscarding(true),
    keepEditing: () => setDiscarding(false),
    discard() {
      setDiscarding(false);
      setVersion(version + 1);
    },
  };
}

type FormPageControl = ReturnType<typeof useFormPage>;

/**
 * What an edit page shows of its record beside its title, when the edit page
 * is the record's only page: its status, its actions (deactivate, delete) and
 * their refusal.
 */
export interface RecordHeader {
  status?: ReactNode;
  /** The record's id, so its name moves from the list row into the title (`RecordName`). */
  transitionId?: string;
  /** The actions, disabled while `busy`: the form saves, or the page leaves. */
  actions: (busy: boolean) => ReactNode;
  error: string | null;
  /** The record's own alert, first in the page's `AlertStack`: an archived one's (`ArchivedAlert`). */
  alert?: ReactNode;
}

/**
 * The button that opens a create, for whoever may create: in the page
 * header's `actions`, and again in the list's `EmptyState`. `link` is the
 * `Link` to its page; `onClick` opens its dialog instead (`FormDialog`).
 */
export function CreateButton(
  props: { can?: boolean; children: ReactNode } & (
    | { link: ReactElement; onClick?: never }
    | { onClick: () => void; link?: never }
  ),
) {
  if (props.can === false) {
    return null;
  }
  const icon = <PlusIcon data-icon="inline-start" aria-hidden />;
  if (props.onClick) {
    return (
      <Button onClick={props.onClick}>
        {icon}
        {props.children}
      </Button>
    );
  }
  return (
    <Button nativeButton={false} render={props.link}>
      {icon}
      {props.children}
    </Button>
  );
}

const noRefusals: FieldProblem[] = [];

const refusalText = (refusals: FieldProblem[]) => refusals.map((refusal) => refusal.message).join();

/** What `FormPage` needs of `useAppForm`'s form. */
type PageForm = Pick<AnyFormApi, "store" | "handleSubmit" | "reset">;

/**
 * A create or an edit on a page of its own: the fields sit in rows by their
 * size, and the actions close the form, sticking to the bottom of the window on a long one. On an edit,
 * `Descartar cambios` shows once something differs from what the form opened with; a create has none,
 * since `Volver` already drops what it holds, and leaving still asks first. While `pending`, the
 * spinner is on the submit button, and the fields and other buttons wait: what
 * is typed then would be lost when the save goes back.
 */
export function FormPage(props: {
  page: FormPageControl;
  form: PageForm;
  title: string;
  description?: string;
  submitLabel: string;
  /** What the submit does beyond saving, beside its button. */
  submitNote?: string;
  /** The form makes a new record, so it has no saved values to go back to. */
  creates?: boolean;
  pending: boolean;
  /** What the server refused: under the field it names, or above the form. */
  refusals?: FieldProblem[];
  /** Clears what the last submit answered. */
  onClear: () => void;
  /**
   * Above the fields, outside the form element: what holds a form of its own,
   * such as the patient picker's quick registration.
   */
  lead?: ReactNode;
  record?: RecordHeader;
  /** What the form sits in below the title, such as a tab beside the record's other parts. */
  frame?: (content: ReactNode) => ReactNode;
  /** The page's alerts, in its `AlertStack` under the header: why a field is locked, for one. */
  alerts?: ReactNode;
  children: ReactNode;
}) {
  const { page, form, record = noRecord, refusals = noRefusals, frame = unframed } = props;
  const problems = [...page.problems, ...refusals];
  const content = useRef<HTMLDivElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  // Going back waits for the page's data, and nothing here may run again meanwhile.
  const pending = props.pending || page.leaving;
  const dirty = !useStore(form.store, (state) => state.isDefaultValue);
  const question = useLeaveQuestion(page, dirty);

  // Whichever way the problems arrived.
  useFocusProblem(content, alert, [page.problemsShown, refusalText(refusals)]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    page.clearProblems();
    props.onClear();
    void form.handleSubmit();
  }

  return (
    <div className="flex flex-col gap-6">
      <FormPageHeader
        title={props.title}
        description={props.description}
        record={record}
        alerts={props.alerts}
        pending={pending}
      />
      <FormProblemsContext.Provider value={problems}>
        {/* A discard remounts the form: what its fields keep of their own goes too. */}
        {frame(
          <div key={page.version} ref={content} className="flex flex-col gap-4">
            <RefusalAlert focusRef={alert} problems={problems} />
            {props.lead && <FormGrid disabled={pending}>{props.lead}</FormGrid>}
            <form method="post" noValidate onSubmit={submit}>
              <Card>
                <CardContent>
                  <FormGrid disabled={pending}>{props.children}</FormGrid>
                </CardContent>
                <FormPageActions
                  page={page}
                  pending={pending}
                  submitLabel={props.submitLabel}
                  submitNote={props.submitNote}
                  discardable={!props.creates && dirty}
                />
              </Card>
            </form>
          </div>,
        )}
      </FormProblemsContext.Provider>
      <ConfirmDialog
        open={question.open}
        onOpenChange={(open) => !open && question.keepEditing()}
        title="¿Descartar los cambios?"
        description="Lo que cambiaste en este formulario no se guarda."
        cancelLabel="Seguir editando"
        confirmLabel="Descartar cambios"
        onConfirm={() => {
          form.reset();
          page.clearProblems();
          props.onClear();
          question.discard();
        }}
      />
    </div>
  );
}

const noRecord: RecordHeader = { actions: () => null, error: null };

/**
 * The question before discarding the changes or leaving with them, open for
 * either: leaving asks while the form differs, unless the page leaves by `leave`.
 */
function useLeaveQuestion(page: FormPageControl, dirty: boolean) {
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !page.released(),
    enableBeforeUnload: () => dirty && !isSessionChanging(),
    withResolver: true,
  });
  const blocked = blocker.status === "blocked";
  return {
    open: page.discarding || blocked,
    keepEditing() {
      page.keepEditing();
      blocker.reset?.();
    },
    discard() {
      if (blocked) {
        blocker.proceed();
        return;
      }
      page.discard();
    },
  };
}

const unframed = (content: ReactNode) => content;

/** The page's title, with its record's status and actions, which wait while it saves or leaves. */
function FormPageHeader(props: {
  title: string;
  description?: string;
  record: RecordHeader;
  alerts?: ReactNode;
  pending: boolean;
}) {
  const { record } = props;
  return (
    <>
      <PageHeader
        title={
          record.transitionId ? (
            <RecordName id={record.transitionId}>{props.title}</RecordName>
          ) : (
            props.title
          )
        }
        status={record.status}
        description={
          props.description && <p className="text-muted-foreground text-sm">{props.description}</p>
        }
        actions={record.actions(props.pending)}
      />
      <AlertStack>
        {record.error && <ErrorAlert message={record.error} />}
        {record.alert}
        {props.alerts}
      </AlertStack>
    </>
  );
}

/** The one error above the form: a refusal about no field. */
function RefusalAlert({
  focusRef,
  problems,
}: {
  focusRef: Ref<HTMLDivElement>;
  problems: FieldProblem[];
}) {
  const refusal = problems.find((problem) => !problem.field);
  if (!refusal) {
    return null;
  }
  return (
    <div ref={focusRef} tabIndex={-1} className="outline-none">
      <ErrorAlert message={refusal.message} />
    </div>
  );
}

/**
 * `Volver` on the left; `Descartar cambios`, once it applies, and the submit
 * button on the right, after the note on what it does, if any, all in one row.
 * The right-hand buttons wrap under `Volver` only when they do not fit, as
 * three buttons and a long submit label on a phone.
 */
function FormPageActions(props: {
  page: FormPageControl;
  pending: boolean;
  submitLabel: string;
  submitNote?: string;
  /** Whether `Descartar cambios` shows: an edit whose form differs from what it opened with. */
  discardable: boolean;
}) {
  const { page, pending } = props;
  return (
    <CardFooter className="sticky bottom-0">
      <div
        className={cn(
          "flex w-full flex-wrap items-center justify-between gap-3",
          !props.submitNote && "sm:flex-nowrap",
        )}
      >
        <Button type="button" variant="outline" disabled={pending} onClick={page.goBack}>
          <ChevronLeftIcon data-icon="inline-start" aria-hidden />
          Volver
        </Button>
        {/* On a narrow screen, a row of its own above the buttons. */}
        {props.submitNote && (
          <p className="text-muted-foreground order-first basis-full text-sm sm:order-none sm:ml-auto sm:basis-auto sm:text-right">
            {props.submitNote}
          </p>
        )}
        {/* Below `sm`, its buttons sit in the bar's own rows: the submit on one of its own. */}
        <div className="contents sm:flex sm:items-center sm:gap-3">
          {props.discardable && (
            <Button
              type="button"
              variant="outline"
              className="ml-auto sm:ml-0"
              disabled={pending}
              onClick={page.askToDiscard}
            >
              <Undo2Icon data-icon="inline-start" aria-hidden />
              Descartar cambios
            </Button>
          )}
          <Button type="submit" className="basis-full sm:basis-auto" disabled={pending}>
            {pending ? (
              <Spinner data-icon="inline-start" aria-hidden />
            ) : (
              <CheckIcon data-icon="inline-start" aria-hidden />
            )}
            {props.submitLabel}
          </Button>
        </div>
      </div>
    </CardFooter>
  );
}

/** A `FormPage` that submits through `useFormAction`, whose refusal shows above the fields. */
export function ActionFormPage(props: {
  page: FormPageControl;
  form: PageForm;
  title: string;
  description?: string;
  submitLabel: string;
  creates?: boolean;
  record?: RecordHeader;
  frame?: (content: ReactNode) => ReactNode;
  alerts?: ReactNode;
  action: {
    pending: boolean;
    error: string | null;
    errorField: string;
    setError: (error: string | null) => void;
  };
  children: ReactNode;
}) {
  const { action, children, ...page } = props;
  const refusals = action.error ? [{ field: action.errorField, message: action.error }] : undefined;
  return (
    <FormPage
      {...page}
      pending={action.pending}
      refusals={refusals}
      onClear={() => action.setError(null)}
    >
      {children}
    </FormPage>
  );
}
