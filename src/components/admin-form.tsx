import { useRouter } from "@tanstack/react-router";
import { EllipsisIcon, PowerIcon, PowerOffIcon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { DeactivateButton, useDeactivation } from "#/components/confirm-dialog.tsx";
import type { Deactivation } from "#/components/confirm-dialog.tsx";
import type { RecordHeader } from "#/components/form-page.tsx";
import { serverAnswer, shownPath } from "#/components/save-failure.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";

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

/**
 * Deactivates or reactivates the record on its page. `deactivation` is for a
 * record whose deactivation sends appointments to the "to reschedule" list: it
 * asks first when it does.
 */
function ActiveToggle(props: {
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
 * A record's actions as one `Acciones` menu beside its title: `items` first,
 * such as a create for one of its lists, then `Desactivar` or `Reactivar`.
 */
function RecordActionsMenu(props: {
  active: boolean;
  pending: boolean;
  onChange: (active: boolean) => void;
  deactivation?: Deactivation;
  items?: ReactNode;
}) {
  const { active, pending, deactivation } = props;
  const deactivate = useDeactivation(
    deactivation ?? { question: "", countUpcoming: noUpcoming },
    () => props.onChange(false),
  );
  const toggle = () => (active && deactivation ? deactivate.request() : props.onChange(!active));
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" disabled={pending} />}>
          <EllipsisIcon data-icon="inline-start" />
          Acciones
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto">
          {props.items && (
            <>
              <DropdownMenuGroup>{props.items}</DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            variant={active ? "destructive" : "default"}
            disabled={deactivate.checking}
            onClick={toggle}
          >
            {active ? <PowerOffIcon /> : <PowerIcon />}
            {active ? "Desactivar" : "Reactivar"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {deactivate.dialog}
    </>
  );
}

const noUpcoming = () => Promise.resolve({ ok: true as const, count: 0 });

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
  /** The actions as one `Acciones` menu, `items` first (`RecordActionsMenu`). */
  menu?: { items?: ReactNode };
}): RecordHeader {
  const { active, toggle, menu } = props;
  return {
    status: !active && <Badge variant="secondary">{props.inactiveLabel}</Badge>,
    actions: (busy) =>
      menu ? (
        <RecordActionsMenu
          active={active}
          pending={toggle.pending || busy}
          onChange={props.onChange}
          deactivation={props.deactivation}
          items={menu.items}
        />
      ) : (
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

/** A record's state in a table's `Estado` column: `Activa` or `Inactiva`, by the noun's ending. */
export function ActiveBadge({ active, ending }: { active: boolean; ending: "a" | "o" }) {
  return active ? (
    <Badge variant="success">{`Activ${ending}`}</Badge>
  ) : (
    <Badge variant="secondary">{`Inactiv${ending}`}</Badge>
  );
}
