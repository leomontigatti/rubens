import { useState } from "react";

import { ErrorAlert } from "#/components/admin-form.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { toast } from "#/components/ui/toast.tsx";
import { resetStartingPassword } from "#/server/staff.functions.ts";

import { useAction } from "#/routes/_app/personal/-shared.tsx";

/**
 * `Asignar contraseña inicial`, from a member's `Acciones`: a dialog with the
 * one field, which closes on a save and says so in a toast.
 */
export function useStartingPasswordDialog(member: { memberId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const action = useAction();
  const form = useAppForm({
    defaultValues: { password: "" },
    onSubmit: async ({ value, formApi }) => {
      const { password } = value;
      const done = await action.run(() =>
        resetStartingPassword({ data: { memberId: member.memberId, password } }),
      );
      if (done) {
        formApi.reset();
        setOpen(false);
        toast.add({
          title: "Contraseña asignada",
          description: "La persona tiene que cambiarla la próxima vez que ingrese.",
          type: "success",
        });
      }
    },
  });

  function change(next: boolean) {
    if (!next) {
      form.reset();
      action.setError(null);
    }
    setOpen(next);
  }

  const dialog = (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Asignar contraseña inicial</DialogTitle>
          <DialogDescription>
            {`Reemplaza la contraseña actual de ${member.name}. La usa para ingresar y la cambia al entrar.`}
          </DialogDescription>
        </DialogHeader>
        <ErrorAlert message={action.error} />
        <form.AppField name="password">
          {(field) => (
            <field.TextField label="Contraseña inicial nueva" autoComplete="off" required />
          )}
        </form.AppField>
        <DialogFooter>
          <Button variant="outline" disabled={action.pending} onClick={() => change(false)}>
            Cancelar
          </Button>
          <Button disabled={action.pending} onClick={() => void form.handleSubmit()}>
            {action.pending && <Spinner data-icon="inline-start" aria-hidden />}
            Asignar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { open: () => setOpen(true), dialog };
}
