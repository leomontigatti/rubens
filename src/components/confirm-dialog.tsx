import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
import { upcomingAppointmentsNotice } from "#/lib/appointments.ts";

/** Asks before a destructive action; `confirmLabel` repeats the action's name. */
export function ConfirmDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  function confirm() {
    props.onOpenChange(false);
    props.onConfirm();
  }

  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={confirm}>
            {props.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * `Desactivar` for someone or a place: it asks first when that sends appointments
 * to the list, saying how many, and deactivates at once when it sends none.
 * A refused count deactivates too: the deactivation is refused the same way,
 * and shows why.
 */
export function DeactivateButton(props: {
  question: string;
  size?: "default" | "sm";
  pending: boolean;
  countUpcoming: () => Promise<{ ok: true; count: number } | { ok: false }>;
  onDeactivate: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [upcoming, setUpcoming] = useState(0);
  const [open, setOpen] = useState(false);

  async function request() {
    setChecking(true);
    const result = await props.countUpcoming().finally(() => setChecking(false));
    if (result.ok && result.count > 0) {
      setUpcoming(result.count);
      setOpen(true);
    } else {
      props.onDeactivate();
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size={props.size}
        disabled={props.pending || checking}
        onClick={() => void request()}
      >
        Desactivar
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={props.question}
        description={upcomingAppointmentsNotice(upcoming)}
        confirmLabel="Desactivar"
        onConfirm={props.onDeactivate}
      />
    </>
  );
}
