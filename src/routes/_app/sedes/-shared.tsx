import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";
import type * as z from "zod";

import { Alert, AlertDescription } from "#/components/ui/alert.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card.tsx";

// The pieces the office and room screens share: refusal copy, the admin
// controls, and the submit step every form and button goes through.

/** The copy for every refusal the office and room server functions return. */
const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador puede cambiar sedes y consultorios.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "No encontramos esa sede o ese consultorio.",
};

export type RefusalReason = keyof typeof refusalMessages;

export type ActionResult = { ok: true } | { ok: false; reason: RefusalReason };

/** The message for the first field `error` names, from `messages`. */
export function fieldMessage<T extends string>(
  messages: Record<T, string>,
  error: z.ZodError,
): string {
  const [issue] = error.issues;
  return messages[issue!.path[0] as T];
}

/**
 * Runs a server function, shows its refusal as copy, and reloads the route's
 * data when it succeeds. `run` resolves to whether it succeeded.
 */
export function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(action: () => Promise<ActionResult>): Promise<boolean> {
    setPending(true);
    setError(null);
    const result = await action();
    setPending(false);
    if (!result.ok) {
      setError(refusalMessages[result.reason]);
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
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function RefusalAlert({ reason }: { reason: RefusalReason }) {
  return (
    <div className="mx-auto max-w-3xl">
      <ErrorAlert message={refusalMessages[reason]} />
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
