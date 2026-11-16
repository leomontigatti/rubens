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
 * A question with two answers (`alternative`), or one whose action loses
 * nothing (`destructive: false`), shows no answer as destructive, and leaves
 * `Cancelar` the quietest.
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
  /** Whether confirming loses something; `false` for an action that only moves work along. */
  destructive?: boolean;
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
            variant={alternative || props.destructive === false ? "default" : "destructive"}
            onClick={() => answer(props.onConfirm)}
          >
            {props.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export interface Deactivation {
  question: string;
  countUpcoming: () => Promise<{ ok: true; count: number } | { ok: false }>;
}

/**
 * A deactivation that asks first when it sends appointments to the list, saying
 * how many, and deactivates at once when it sends none. A refused count
 * deactivates too: the deactivation is refused the same way, and shows why.
 * `dialog` goes outside whatever starts it, such as a menu that closes on a pick.
 */
export function useDeactivation(deactivation: Deactivation, onDeactivate: () => void) {
  const [checking, setChecking] = useState(false);
  const [upcoming, setUpcoming] = useState(0);
  const [open, setOpen] = useState(false);

  async function request() {
    setChecking(true);
    const result = await deactivation.countUpcoming().finally(() => setChecking(false));
    if (result.ok && result.count > 0) {
      setUpcoming(result.count);
      setOpen(true);
    } else {
      onDeactivate();
    }
  }

  return {
    checking,
    request: () => void request(),
    dialog: (
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={deactivation.question}
        description={upcomingAppointmentsNotice(upcoming)}
        confirmLabel="Desactivar"
        onConfirm={onDeactivate}
      />
    ),
  };
}

/** `Desactivar` for someone or a place, as a button (`useDeactivation`). */
export function DeactivateButton(
  props: Deactivation & { size?: "default" | "sm"; pending: boolean; onDeactivate: () => void },
) {
  const deactivate = useDeactivation(props, props.onDeactivate);
  return (
    <>
      <Button
        variant="outline"
        size={props.size}
        disabled={props.pending || deactivate.checking}
        onClick={deactivate.request}
      >
        Desactivar
      </Button>
      {deactivate.dialog}
    </>
  );
}
