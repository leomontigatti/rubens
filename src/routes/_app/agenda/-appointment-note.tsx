import { useState } from "react";
import type { FormEvent } from "react";

import { ErrorAlert, useFormAction } from "#/components/admin-form.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { receptionNoteMaxLength } from "#/lib/appointments.ts";
import { editAppointmentNote } from "#/server/appointments.functions.ts";

// The reception note: its field, shared with booking, and editing it on an
// appointment.

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo recepción, un administrador o el propio profesional pueden cambiar el turno.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá la nota de recepción.",
  notFound: "No encontramos ese turno.",
  practitionerInactive: "Ese profesional está inactivo.",
};

export function ReceptionNoteField(props: {
  id: string;
  value: string;
  onChange: (receptionNote: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={props.id}>Nota de recepción (opcional)</Label>
      <Input
        id={props.id}
        value={props.value}
        maxLength={receptionNoteMaxLength}
        placeholder="Por ejemplo: trae radiografías"
        onChange={(event) => props.onChange(event.target.value)}
        aria-describedby={`${props.id}-hint`}
      />
      <p id={`${props.id}-hint`} className="text-muted-foreground text-xs">
        La información clínica va en la historia clínica, no acá.
      </p>
    </div>
  );
}

/** The appointment's note, and "Editar nota" to change it. */
export function NoteSection(props: {
  appointment: { id: string; receptionNote: string | null };
  onDone: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(props.appointment.receptionNote ?? "");
  const { run, pending, error } = useFormAction(refusalMessages);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = { appointmentId: props.appointment.id, receptionNote: note };
    if (await run(() => editAppointmentNote({ data }))) {
      props.onDone();
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm">{props.appointment.receptionNote ?? "Sin nota de recepción."}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
          Editar nota
        </Button>
      </div>
    );
  }
  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      <ReceptionNoteField id="appointment-note" value={note} onChange={setNote} />
      <ErrorAlert message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          Guardar nota
        </Button>
        <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
          Volver
        </Button>
      </div>
    </form>
  );
}
