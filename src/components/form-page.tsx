import { useBlocker, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import type { NavigateOptions } from "@tanstack/react-router";
import { CheckIcon, ChevronLeftIcon, Undo2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";

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
  const released = useRef(false);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !released.current,
    enableBeforeUnload: dirty,
    withResolver: true,
  });

  function goBack() {
    if (canGoBack) {
      router.history.back();
    } else {
      void navigate(back);
    }
  }

  /** Leaves without asking: what is saved, or a way out the form itself offers. */
  function leave(to?: NavigateOptions) {
    released.current = true;
    if (to) {
      void navigate(to);
    } else {
      goBack();
    }
  }

  return {
    dirty,
    setDirty,
    version,
    goBack,
    leave,
    /** The question before discarding or leaving, open for either. */
    asking: discarding || blocker.status === "blocked",
    askToDiscard: () => setDiscarding(true),
    keepEditing() {
      setDiscarding(false);
      blocker.reset?.();
    },
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

/** What the form holds, to compare with what it opened with. */
function snapshot(form: HTMLFormElement): string {
  return JSON.stringify([...new FormData(form).entries()]);
}

/**
 * A create or an edit on a page of its own: the fields take the page's width,
 * and the actions stay at the bottom of the window. `Descartar cambios` shows
 * once something differs from what the form opened with. While `pending`, the
 * spinner is on the submit button and the other buttons wait.
 */
export function FormPage(props: {
  page: FormPageControl;
  title: string;
  description?: string;
  submitLabel: string;
  pending: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Clears what the last submit answered. */
  onDiscard: () => void;
  children: ReactNode;
}) {
  const { page, pending } = props;
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
        {props.children}
        <div className="bg-background sticky bottom-0 flex items-center justify-between gap-3 border-t py-4">
          <Button type="button" variant="outline" disabled={pending} onClick={page.goBack}>
            <ChevronLeftIcon data-icon="inline-start" aria-hidden />
            Volver
          </Button>
          <div className="flex items-center gap-3">
            {page.dirty && (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={page.askToDiscard}
              >
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
