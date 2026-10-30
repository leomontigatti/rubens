import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";
import type * as z from "zod";

import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card.tsx";

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
 * and reloads the route's data when it succeeds. `run` resolves to whether it
 * succeeded.
 */
export function useFormAction<R extends string>(messages: Record<R, string>) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(
    action: () => Promise<{ ok: true } | { ok: false; reason: R }>,
  ): Promise<boolean> {
    setPending(true);
    setError(null);
    let result: Awaited<ReturnType<typeof action>>;
    try {
      result = await action();
    } finally {
      setPending(false);
    }
    if (!result.ok) {
      setError(messages[result.reason]);
      return false;
    }
    await router.invalidate();
    return true;
  }

  return { error, setError, pending, run };
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

/** Edit and deactivate or reactivate, shown to admins only. */
export function AdminControls(props: {
  isAdmin: boolean;
  active: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
}) {
  if (!props.isAdmin) {
    return null;
  }
  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={props.onEdit}>
        Editar
      </Button>
      <Button variant="outline" size="sm" onClick={props.onToggleActive}>
        {props.active ? "Desactivar" : "Reactivar"}
      </Button>
    </div>
  );
}

/**
 * The admin's button that opens a creation form in a card. `children` gets the
 * function that closes it.
 */
export function CreatePanel(props: {
  isAdmin: boolean;
  label: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!props.isAdmin) {
    return null;
  }
  if (!open) {
    return (
      <div>
        <Button onClick={() => setOpen(true)}>{props.label}</Button>
      </div>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.label}</CardTitle>
      </CardHeader>
      <CardContent>{props.children(() => setOpen(false))}</CardContent>
    </Card>
  );
}
