import { useRouter } from "@tanstack/react-router";
import { EllipsisIcon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { useDeactivation } from "#/components/confirm-dialog.tsx";
import type { Deactivation } from "#/components/confirm-dialog.tsx";
import type { RecordHeader } from "#/components/form-page.tsx";
import { serverAnswer, shownPath } from "#/components/save-failure.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
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
 * A record's `Acciones` menu, beside its page's title: `children` are its
 * items. A dialog an item opens goes beside the menu, not in it, which closes
 * on a pick.
 */
export function ActionsMenu(props: { disabled: boolean; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" disabled={props.disabled} />}>
        <EllipsisIcon data-icon="inline-start" />
        Acciones
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        {props.children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A record's `Acciones`: `items` first, such as a create for one of its lists,
 * then, past a separator, `states`, such as a patient's WhatsApp, and
 * `Archivar` in red or `Restaurar`. `deactivation` is for a record whose
 * deactivation sends appointments to the "to reschedule" list: it asks first
 * when it does.
 */
function RecordActionsMenu(props: {
  active: boolean;
  pending: boolean;
  onChange: (active: boolean) => void;
  deactivation?: Deactivation;
  items?: ReactNode;
  states?: ReactNode;
}) {
  const { active, deactivation } = props;
  const deactivate = useDeactivation(
    deactivation ?? { question: "", countUpcoming: noUpcoming },
    () => props.onChange(false),
  );
  const toggle = () => (active && deactivation ? deactivate.request() : props.onChange(!active));
  return (
    <>
      <ActionsMenu disabled={props.pending}>
        <LeadingItems items={props.items} />
        {props.states}
        <ArchiveItem active={active} disabled={deactivate.checking} onClick={toggle} />
      </ActionsMenu>
      {deactivate.dialog}
    </>
  );
}

const noUpcoming = () => Promise.resolve({ ok: true as const, count: 0 });

/** The menu's first items, such as its creates, past a separator from its states. */
function LeadingItems(props: { items?: ReactNode }) {
  if (!props.items) {
    return null;
  }
  return (
    <>
      <DropdownMenuGroup>{props.items}</DropdownMenuGroup>
      <DropdownMenuSeparator />
    </>
  );
}

/** `Archivar` in red, or `Restaurar`. */
function ArchiveItem(props: { active: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <DropdownMenuItem
      variant={props.active ? "destructive" : "default"}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.active ? "Archivar" : "Restaurar"}
    </DropdownMenuItem>
  );
}

/** What an archived record's page says about it: `Sede archivada`, and what archiving it changes. */
export interface ArchivedNotice {
  title: string;
  consequence: string;
}

/**
 * An archived record's alert, above its page's form: what archiving it
 * changes, and `Restaurar` for whoever may restore it (`onRestore`); for the
 * rest, who can. `info`, like its badge.
 */
export function ArchivedAlert(props: {
  notice: ArchivedNotice;
  ending: "a" | "o";
  onRestore?: () => void;
  pending?: boolean;
}) {
  const { notice } = props;
  return (
    <Alert variant="info">
      <AlertTitle>{notice.title}</AlertTitle>
      <AlertDescription>
        {props.onRestore
          ? notice.consequence
          : `${notice.consequence} Un administrador puede restaurarl${props.ending}.`}
      </AlertDescription>
      {props.onRestore && (
        <AlertAction>
          <Button size="sm" variant="link" disabled={props.pending} onClick={props.onRestore}>
            Restaurar
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}

/**
 * The header of a record's page, which is its edit form: its state as an
 * `ArchivedBadge` (`ending` gives `Archivada` or `Archivado`), its `Acciones`
 * (`RecordActionsMenu`), which run through `toggle`, the page's
 * `useFormAction`, and, while it is archived, its `ArchivedAlert` with
 * `Restaurar` (`archived` says what it means). `transitionId` carries the
 * record's name from its list row into the title.
 */
export function activeRecord(props: {
  active: boolean;
  ending: "a" | "o";
  archived: ArchivedNotice;
  toggle: { pending: boolean; error: string | null };
  onChange: (active: boolean) => void;
  deactivation?: Deactivation;
  /** What comes first in the menu: a create for one of the record's lists. */
  items?: ReactNode;
  /** The record's other states, beside `Archivar`: a patient's WhatsApp. */
  states?: ReactNode;
  transitionId?: string;
}): RecordHeader {
  const { active, toggle } = props;
  return {
    status: <ArchivedBadge active={active} ending={props.ending} />,
    alert: active ? undefined : (
      <ArchivedAlert
        notice={props.archived}
        ending={props.ending}
        pending={toggle.pending}
        onRestore={() => props.onChange(true)}
      />
    ),
    transitionId: props.transitionId,
    actions: (busy) => (
      <RecordActionsMenu
        active={active}
        pending={toggle.pending || busy}
        onChange={props.onChange}
        deactivation={props.deactivation}
        items={props.items}
        states={props.states}
      />
    ),
    error: toggle.error,
  };
}

/**
 * An archived record's state, `Archivada` or `Archivado` by the noun's ending:
 * beside its name in a list and on its page. An active record shows none, as
 * a badge only shows a state out of the ordinary. `info`, like the archived
 * alert on its page.
 */
export function ArchivedBadge({ active, ending }: { active: boolean; ending: "a" | "o" }) {
  return active ? null : <Badge variant="info">{`Archivad${ending}`}</Badge>;
}
