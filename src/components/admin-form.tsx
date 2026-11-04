import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { ComponentProps } from "react";

import { DeactivateButton } from "#/components/confirm-dialog.tsx";
import type { RecordHeader } from "#/components/form-page.tsx";
import { saveFailedMessage, serverAnswer, shownPath } from "#/components/save-failure.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Button } from "#/components/ui/button.tsx";

// The pieces the admin screens (offices and rooms, staff) share: the submit
// step every form and button goes through, its error copy, and a record's
// deactivate or reactivate button.

/**
 * Runs a server function, shows its refusal as the copy `messages` gives it,
 * and reloads the route's data when it succeeds, pending until that is done.
 * `run` resolves to whether it succeeded; so does `save`, which reloads nothing.
 */
export function useFormAction<R extends string>(
  messages: Record<R, string>,
  /** The refusals about one field, by the form's name for it. */
  refusalFields: Partial<Record<R, string>> = {},
) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState("");
  const [pending, setPending] = useState(false);

  type Action = () => Promise<{ ok: true } | { ok: false; reason: R }>;

  /** What `run` and `save` share: whether it succeeded, with its refusal shown if not. */
  async function attempt(action: Action, after?: () => Promise<void>): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const result = await serverAnswer("form-action", shownPath(router), action);
      if (!result) {
        setError(saveFailedMessage);
        setErrorField("");
        return false;
      }
      if (!result.ok) {
        setError(messages[result.reason]);
        setErrorField(refusalFields[result.reason] ?? "");
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
    errorField,
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
 * Deactivates or reactivates the record on its page. `deactivation` is for a
 * record whose deactivation sends appointments to the "to reschedule" list: it
 * asks first when it does.
 */
export function ActiveToggle(props: {
  active: boolean;
  pending: boolean;
  onChange: (active: boolean) => void;
  deactivation?: Deactivation;
}) {
  const { active, pending, deactivation } = props;
  if (active && deactivation) {
    return (
      <DeactivateButton
        {...deactivation}
        pending={pending}
        onDeactivate={() => props.onChange(false)}
      />
    );
  }
  return (
    <Button variant="outline" disabled={pending} onClick={() => props.onChange(!active)}>
      {active ? "Desactivar" : "Reactivar"}
    </Button>
  );
}

/**
 * The header of an edit page that is its record's only page: a badge saying
 * `inactiveLabel` while the record is inactive, and its `ActiveToggle`, which
 * runs through `toggle`, the page's `useFormAction`.
 */
export function activeRecord(props: {
  active: boolean;
  inactiveLabel: string;
  toggle: { pending: boolean; error: string | null };
  onChange: (active: boolean) => void;
  deactivation?: Deactivation;
}): RecordHeader {
  const { active, toggle } = props;
  return {
    status: !active && <Badge variant="secondary">{props.inactiveLabel}</Badge>,
    actions: (busy) => (
      <ActiveToggle
        active={active}
        pending={toggle.pending || busy}
        onChange={props.onChange}
        deactivation={props.deactivation}
      />
    ),
    error: toggle.error,
  };
}
