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

/**
 * Asks before a destructive action; `confirmLabel` repeats the action's name.
 * A question with two answers (`alternative`) shows neither as destructive,
 * since neither loses anything, and leaves `Cancelar` the quietest.
 */
export function ConfirmDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  cancelLabel?: string;
  confirmLabel: string;
  onConfirm: () => void;
  alternative?: { label: string; onSelect: () => void };
}) {
  const { alternative } = props;
  // In this order: closing first would read as a dismissal, and undo what confirming does.
  function answer(choose: () => void) {
    choose();
    props.onOpenChange(false);
  }

  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* Wide enough at the design width for three buttons in a row. */}
      <AlertDialogContent className={alternative && "data-[size=default]:sm:max-w-md"}>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel variant={alternative ? "ghost" : "outline"}>
            {props.cancelLabel ?? "Cancelar"}
          </AlertDialogCancel>
          {alternative && (
            <AlertDialogAction variant="outline" onClick={() => answer(alternative.onSelect)}>
              {alternative.label}
            </AlertDialogAction>
          )}
          <AlertDialogAction
            variant={alternative ? "default" : "destructive"}
            onClick={() => answer(props.onConfirm)}
          >
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
