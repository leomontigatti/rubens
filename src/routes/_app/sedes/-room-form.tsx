import { PowerIcon, PowerOffIcon } from "lucide-react";
import { useState } from "react";
import type * as z from "zod";

import { ArchivedBadge } from "#/components/admin-form.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { useDeactivation } from "#/components/confirm-dialog.tsx";
import { FormDialog, useFormDialog } from "#/components/form-dialog.tsx";
import type { FormDialogControl } from "#/components/form-dialog.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { Button } from "#/components/ui/button.tsx";
import { roomUpdateSchema } from "#/lib/offices.ts";
import {
  addRoom,
  changeRoomActive,
  editRoom,
  getRoomUpcomingCount,
} from "#/server/offices.functions.ts";
import type { Room } from "#/organization/offices.ts";

import { useAction } from "#/routes/_app/sedes/-shared.tsx";

// An office's rooms are created and edited in a dialog over its `Consultorios`
// tab (style guide, Form dialogs): one field and a state, nothing of their own.

// The room form's fields: the room update schema without the id it is sent with.
const roomFieldsSchema = roomUpdateSchema.omit({ roomId: true });

const fieldMessages: Record<keyof z.input<typeof roomFieldsSchema>, string> = {
  name: "Ingresá el nombre del consultorio.",
};

/**
 * The office's room dialog: `create` opens it empty, `edit` on a room, which
 * `rooms`, the list as last loaded, keeps current while it is open.
 */
export function useRoomDialog(officeId: string, rooms: Room[]) {
  const dialog = useFormDialog();
  // A new key on each opening, so the form starts from what it opens on.
  const [opening, setOpening] = useState<{ room: Room | null; count: number }>({
    room: null,
    count: 0,
  });
  const open = (room: Room | null) => {
    setOpening(({ count }) => ({ room, count: count + 1 }));
    dialog.show();
  };
  // As last loaded; as opened once the list drops it (archived, while it closes).
  const room = opening.room
    ? (rooms.find((one) => one.id === opening.room?.id) ?? opening.room)
    : null;
  return {
    create: () => open(null),
    edit: open,
    dialog: <RoomDialog key={opening.count} dialog={dialog} officeId={officeId} room={room} />,
  };
}

function RoomDialog(props: { dialog: FormDialogControl; officeId: string; room: Room | null }) {
  const { dialog, officeId, room } = props;
  const action = useAction();
  const form = useAppForm({
    defaultValues: roomValues(room),
    onSubmit: async ({ value }) => {
      const fields = roomFieldsSchema.safeParse(value);
      if (!fields.success) {
        dialog.showProblems(fieldProblems(fields.error.issues, messageIn(fieldMessages)));
        return;
      }
      const saved = await action.run(() =>
        room
          ? editRoom({ data: { ...fields.data, roomId: room.id } })
          : addRoom({ data: { ...fields.data, officeId } }),
      );
      if (saved) {
        dialog.hide();
      }
    },
  });
  const change = async (active: boolean) => {
    if (room && (await action.run(() => changeRoomActive({ data: { id: room.id, active } })))) {
      dialog.hide();
    }
  };
  const deactivate = useDeactivation(roomDeactivation(room), () => void change(false));

  return (
    <FormDialog
      dialog={dialog}
      form={form}
      action={action}
      {...dialogCopy(room)}
      question={deactivate.question}
      aside={
        room && (
          <RoomActiveButton
            active={room.active}
            pending={action.pending}
            checking={deactivate.checking}
            onArchive={deactivate.request}
            onRestore={() => void change(true)}
          />
        )
      }
    >
      <form.AppField name="name">
        {(field) => <field.TextField label="Nombre" required />}
      </form.AppField>
    </FormDialog>
  );
}

/** The form's values: the room's, or a new one's. */
function roomValues(room: Room | null) {
  return { name: room ? room.name : "" };
}

/** What `Archivar` asks before archiving the room, and how it counts the appointments ahead. */
function roomDeactivation(room: Room | null) {
  const id = room ? room.id : "";
  return {
    question: `¿Archivar ${room ? room.name : ""}?`,
    countUpcoming: () => getRoomUpcomingCount({ data: { id } }),
  };
}

/** The dialog's title, description and submit: an edit's, named by the room, or a create's. */
function dialogCopy(room: Room | null) {
  if (!room) {
    return {
      title: "Nuevo consultorio",
      description: "Una sala de la sede donde se atiende.",
      submitLabel: "Crear consultorio",
    };
  }
  return {
    title: (
      <>
        {room.name}
        <ArchivedBadge active={room.active} ending="o" />
      </>
    ),
    description: "Los datos del consultorio.",
    submitLabel: "Guardar",
  };
}

/**
 * `Archivar` or `Restaurar` the room, which closes the dialog once done; a
 * deactivation with appointments ahead asks first, in the dialog.
 */
function RoomActiveButton(props: {
  active: boolean;
  pending: boolean;
  checking: boolean;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const disabled = props.pending || props.checking;
  if (!props.active) {
    return (
      <Button type="button" variant="outline" disabled={disabled} onClick={props.onRestore}>
        <PowerIcon data-icon="inline-start" aria-hidden />
        Restaurar
      </Button>
    );
  }
  return (
    <Button type="button" variant="destructive" disabled={disabled} onClick={props.onArchive}>
      <PowerOffIcon data-icon="inline-start" aria-hidden />
      Archivar
    </Button>
  );
}
