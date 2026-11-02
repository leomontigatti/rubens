import { useBlocker, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import type { NavigateOptions } from "@tanstack/react-router";
import { CheckIcon, ChevronLeftIcon, Undo2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactElement, ReactNode } from "react";

import { ErrorAlert } from "#/components/admin-form.tsx";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Button } from "#/components/ui/button.tsx";
import { FieldSet } from "#/components/ui/field.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { isSessionChanging } from "#/lib/session-change.ts";

/**
 * A form page's way out: `Volver` goes where the browser's back goes, so a list
 * comes back with its filters and page, or to `back` when the page was opened
 * from a link. Leaving with unsaved changes asks first, by any way out.
 */
export function useFormPage(back: NavigateOptions) {
  const router = useRouter();
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const [dirty, setDirty] = useState(false);
  const [version, setVersion] = useState(0);
  const [discarding, setDiscarding] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const released = useRef(false);
  const mounted = useRef(false);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !released.current,
    enableBeforeUnload: () => dirty && !isSessionChanging(),
    withResolver: true,
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function goBack() {
    if (canGoBack) {
      router.history.back();
    } else {
      void navigate(back);
    }
  }

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
   * A save that ends after the user left moves nobody, and refreshes where they are.
   */
  function leave(to?: NavigateOptions) {
    if (!mounted.current) {
      void router.invalidate();
      return;
    }
    released.current = true;
    setLeaving(true);
    exit(to ?? (canGoBack ? null : back));
  }

  return {
    dirty,
    setDirty,
    version,
    leaving,
    goBack,
    leave,
    /** The question before discarding or leaving, open for either. */
    asking: discarding || blocker.status === "blocked",
    askToDiscard: () => setDiscarding(true),
    keepEditing() {
      setDiscarding(false);
      blocker.reset?.();
    },
    /** Opens the form again from what is saved, for a save that stays on the page. */
    reset: () => setVersion(version + 1),
    discard() {
      if (blocker.status === "blocked") {
        blocker.proceed();
        return;
      }
      setDiscarding(false);
      setVersion(version + 1);
    },
  };
}

type FormPageControl = ReturnType<typeof useFormPage>;

/** The button that opens a create's page, for whoever may create. `link` is its `Link`. */
export function CreateButton(props: { can: boolean; link: ReactElement; children: ReactNode }) {
  if (!props.can) {
    return null;
  }
  return (
    <div>
      <Button nativeButton={false} render={props.link}>
        {props.children}
      </Button>
    </div>
  );
}

/** What the form holds, to compare with what it opened with. */
function snapshot(form: HTMLFormElement): string {
  return JSON.stringify([...new FormData(form).entries()]);
}

/**
 * A create or an edit on a page of its own: the fields take the page's width,
 * and the actions close the form, sticking to the bottom of the window on a long one. `Descartar cambios` shows
 * once something differs from what the form opened with. While `pending`, the
 * spinner is on the submit button, and the fields and other buttons wait: what
 * is typed then would be lost when the save goes back.
 */
export function FormPage(props: {
  page: FormPageControl;
  title: string;
  description?: string;
  submitLabel: string;
  pending: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => unknown;
  /** Clears what the last submit answered. */
  onDiscard: () => void;
  children: ReactNode;
}) {
  const { page } = props;
  // Going back waits for the page's data, and nothing here may run again meanwhile.
  const pending = props.pending || page.leaving;
  const form = useRef<HTMLFormElement>(null);
  const opened = useRef("");

  useEffect(() => {
    opened.current = snapshot(form.current!);
    page.setDirty(false);
    // A discard remounts the form, which opens again from what is saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.version]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={props.title}
        description={
          props.description && <p className="text-muted-foreground text-sm">{props.description}</p>
        }
      />
      <form
        key={page.version}
        ref={form}
        noValidate
        className="flex flex-col gap-4"
        onChange={(event) => page.setDirty(snapshot(event.currentTarget) !== opened.current)}
        onSubmit={props.onSubmit}
      >
        <FieldSet disabled={pending}>{props.children}</FieldSet>
        <FormPageActions page={page} pending={pending} submitLabel={props.submitLabel} />
      </form>
      <ConfirmDialog
        open={page.asking}
        onOpenChange={(open) => !open && page.keepEditing()}
        title="¿Descartar los cambios?"
        description="Lo que cambiaste en este formulario no se guarda."
        cancelLabel="Seguir editando"
        confirmLabel="Descartar cambios"
        onConfirm={() => {
          props.onDiscard();
          page.discard();
        }}
      />
    </div>
  );
}

/** `Volver` on the left; `Descartar cambios`, once it applies, and the submit button on the right. */
function FormPageActions(props: { page: FormPageControl; pending: boolean; submitLabel: string }) {
  const { page, pending } = props;
  return (
    <div className="bg-background sticky bottom-0 flex items-center justify-between gap-3 border-t py-4">
      <Button type="button" variant="outline" disabled={pending} onClick={page.goBack}>
        <ChevronLeftIcon data-icon="inline-start" aria-hidden />
        Volver
      </Button>
      <div className="flex items-center gap-3">
        {page.dirty && (
          <Button type="button" variant="outline" disabled={pending} onClick={page.askToDiscard}>
            <Undo2Icon data-icon="inline-start" aria-hidden />
            Descartar cambios
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? (
            <Spinner data-icon="inline-start" aria-hidden />
          ) : (
            <CheckIcon data-icon="inline-start" aria-hidden />
          )}
          {props.submitLabel}
        </Button>
      </div>
    </div>
  );
}

/** A `FormPage` that submits through `useFormAction`, whose refusal shows above the fields. */
export function ActionFormPage(props: {
  page: FormPageControl;
  title: string;
  description?: string;
  submitLabel: string;
  action: { pending: boolean; error: string | null; setError: (error: string | null) => void };
  onSubmit: (event: FormEvent<HTMLFormElement>) => unknown;
  children: ReactNode;
}) {
  const { action, children, ...page } = props;
  return (
    <FormPage {...page} pending={action.pending} onDiscard={() => action.setError(null)}>
      <ErrorAlert message={action.error} />
      {children}
    </FormPage>
  );
}
