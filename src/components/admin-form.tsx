import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { ComponentProps, ReactElement } from "react";
import type * as z from "zod";

import { DeactivateButton } from "#/components/confirm-dialog.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Button } from "#/components/ui/button.tsx";

// The pieces the admin screens (offices and rooms, staff) share: the submit
// step every form and button goes through, its error copy, and the admin
// controls.

/** The message for the first field `error` names, from `messages`. */
export function fieldMessage<T extends string>(
  messages: Record<T, string>,
  error: z.ZodError,
): string {
  const [issue] = error.issues;
  return messages[issue!.path[0] as T];
}

/**
 * Runs a server function, shows its refusal as the copy `messages` gives it,
 * and reloads the route's data when it succeeds, pending until that is done.
 * `run` resolves to whether it succeeded; so does `save`, which reloads nothing.
 */
export function useFormAction<R extends string>(messages: Record<R, string>) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  type Action = () => Promise<{ ok: true } | { ok: false; reason: R }>;

  /** What `run` and `save` share: whether it succeeded, with its refusal shown if not. */
  async function attempt(action: Action, after?: () => Promise<void>): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(messages[result.reason]);
        return false;
      }
      await after?.();
      return true;
    } finally {
      setPending(false);
    }
  }

  return {
    error,
    setError,
    pending,
    run: (action: Action) => attempt(action, () => router.invalidate()),
    /**
     * For a form page, which leaves once saved. Going back reloads what it goes
     * back to; reloading here would reload the form too, and what was saved can
     * take the form away (a schedule ended yesterday can no longer be changed).
     */
    save: (action: Action) => attempt(action),
  };
}

export function ErrorAlert({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <Alert variant="destructive">
      <AlertTitle>Hay un problema</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** A screen's whole content when its loader was refused. */
export function RefusalMessage({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-3xl">
      <ErrorAlert message={message} />
    </div>
  );
}

export function FormActions(props: {
  pending: boolean;
  submitLabel: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-2">
      <Button type="submit" disabled={props.pending}>
        {props.submitLabel}
      </Button>
      <Button type="button" variant="ghost" onClick={props.onCancel}>
        Cancelar
      </Button>
    </div>
  );
}

type Deactivation = Pick<ComponentProps<typeof DeactivateButton>, "question" | "countUpcoming">;

/**
 * Edit and deactivate or reactivate, shown to admins only. `deactivation` is for
 * a record whose deactivation sends appointments to the "to reschedule" list.
 */
export function AdminControls(props: {
  isAdmin: boolean;
  active: boolean;
  /** The `Link` to the record's edit page. */
  editLink: ReactElement;
  onToggleActive: () => void;
  deactivation?: Deactivation;
}) {
  if (!props.isAdmin) {
    return null;
  }
  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" nativeButton={false} render={props.editLink}>
        Editar
      </Button>
      <ActiveToggle {...props} />
    </div>
  );
}

function ActiveToggle(props: {
  active: boolean;
  onToggleActive: () => void;
  deactivation?: Deactivation;
}) {
  if (!props.active || !props.deactivation) {
    return (
      <Button variant="outline" size="sm" onClick={props.onToggleActive}>
        {props.active ? "Desactivar" : "Reactivar"}
      </Button>
    );
  }
  return (
    <DeactivateButton
      {...props.deactivation}
      size="sm"
      pending={false}
      onDeactivate={props.onToggleActive}
    />
  );
}
