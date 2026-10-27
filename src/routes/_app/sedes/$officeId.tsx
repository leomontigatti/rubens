import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import * as z from "zod";

import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { capacityLabel, roomUpdateSchema } from "#/lib/offices.ts";
import {
  addRoom,
  changeRoomActive,
  editRoom,
  getOfficeWithRooms,
} from "#/server/offices.functions.ts";
import type { Office, Room } from "#/server/offices.ts";
import {
  AdminControls,
  CreatePanel,
  ErrorAlert,
  FormActions,
  fieldMessage,
} from "#/components/admin-form.tsx";

import { RefusalAlert, useAction } from "#/routes/_app/sedes/-shared.tsx";
import type { ActionResult } from "#/routes/_app/sedes/-shared.tsx";

export const Route = createFileRoute("/_app/sedes/$officeId")({
  validateSearch: z.object({ inactivos: z.boolean().optional() }),
  loaderDeps: ({ search }) => ({ includeInactive: search.inactivos ?? false }),
  loader: ({ params, deps }) =>
    getOfficeWithRooms({ data: { officeId: params.officeId, ...deps } }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.ok ? `${loaderData.office.name} · Rubens` : "Sede · Rubens" }],
  }),
  component: OfficeRooms,
});

// The room form's fields: the room update schema without the id it is sent with.
const roomFieldsSchema = roomUpdateSchema.omit({ roomId: true });
type RoomFields = z.input<typeof roomFieldsSchema>;

const fieldMessages: Record<keyof RoomFields, string> = {
  name: "Ingresá el nombre del consultorio.",
  capacity: "La capacidad tiene que ser un número entero entre 1 y 100.",
};

const newRoom = { name: "", capacity: 1 };

function OfficeRooms() {
  const { viewer } = Route.useRouteContext();
  const result = Route.useLoaderData();
  const { officeId } = Route.useParams();
  const isAdmin = viewer.roles.includes("admin");

  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <OfficeHeading office={result.office} />
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Consultorios</h2>
        <ShowInactiveRooms />
      </div>
      <CreatePanel isAdmin={isAdmin && result.office.active} label="Nuevo consultorio">
        {(close) => (
          <RoomForm
            idPrefix="new"
            initial={newRoom}
            submitLabel="Crear consultorio"
            onCancel={close}
            onSubmit={(fields) => addRoom({ data: { ...fields, officeId } })}
            onDone={close}
          />
        )}
      </CreatePanel>
      <RoomList rooms={result.rooms} isAdmin={isAdmin} />
    </div>
  );
}

function OfficeHeading({ office }: { office: Office }) {
  return (
    <div className="flex flex-col gap-1">
      <Link
        to="/sedes"
        className="text-muted-foreground text-sm underline-offset-4 hover:underline"
      >
        Sedes
      </Link>
      <h1 className="text-2xl font-semibold">
        {office.name}
        {!office.active && <span className="text-muted-foreground font-normal"> · Inactiva</span>}
      </h1>
      <p className="text-muted-foreground text-sm">
        {office.address} · {office.timeZone}
      </p>
    </div>
  );
}

function ShowInactiveRooms() {
  const { inactivos } = Route.useSearch();
  const { officeId } = Route.useParams();
  return (
    <Button
      variant="outline"
      nativeButton={false}
      render={
        <Link
          to="/sedes/$officeId"
          params={{ officeId }}
          search={{ inactivos: inactivos ? undefined : true }}
        />
      }
    >
      {inactivos ? "Ocultar inactivos" : "Mostrar inactivos"}
    </Button>
  );
}

function RoomList({ rooms, isAdmin }: { rooms: Room[]; isAdmin: boolean }) {
  if (rooms.length === 0) {
    return <p className="text-muted-foreground">Esta sede todavía no tiene consultorios.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {rooms.map((room) => (
        <RoomItem key={room.id} room={room} isAdmin={isAdmin} />
      ))}
    </ul>
  );
}

function RoomItem({ room, isAdmin }: { room: Room; isAdmin: boolean }) {
  const [editing, setEditing] = useState(false);
  const toggle = useAction();

  if (editing) {
    return (
      <li>
        <Card>
          <CardContent>
            <RoomForm
              idPrefix={room.id}
              initial={room}
              submitLabel="Guardar"
              onCancel={() => setEditing(false)}
              onSubmit={(fields) => editRoom({ data: { ...fields, roomId: room.id } })}
              onDone={() => setEditing(false)}
            />
          </CardContent>
        </Card>
      </li>
    );
  }

  return (
    <li>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="font-medium">{room.name}</span>
            <span className="text-muted-foreground text-sm">
              {capacityLabel(room.capacity)}
              {!room.active && " · Inactivo"}
            </span>
          </div>
          <AdminControls
            isAdmin={isAdmin}
            active={room.active}
            onEdit={() => setEditing(true)}
            onToggleActive={() =>
              void toggle.run(() =>
                changeRoomActive({ data: { id: room.id, active: !room.active } }),
              )
            }
          />
          <ErrorAlert message={toggle.error} />
        </CardContent>
      </Card>
    </li>
  );
}

interface RoomFormProps {
  idPrefix: string;
  initial: RoomFields;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (fields: RoomFields) => Promise<ActionResult>;
  onDone: () => void;
}

function RoomForm({ idPrefix, initial, submitLabel, onCancel, onSubmit, onDone }: RoomFormProps) {
  const action = useAction();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = roomFieldsSchema.safeParse({
      name: form.get("name"),
      capacity: Number(form.get("capacity")),
    });
    if (!fields.success) {
      action.setError(fieldMessage(fieldMessages, fields.error));
      return;
    }
    if (await action.run(() => onSubmit(fields.data))) {
      onDone();
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <ErrorAlert message={action.error} />
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-name`}>Nombre</Label>
        <Input id={`${idPrefix}-name`} name="name" defaultValue={initial.name} required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-capacity`}>Capacidad (profesionales a la vez)</Label>
        <Input
          id={`${idPrefix}-capacity`}
          name="capacity"
          type="number"
          min={1}
          max={100}
          step={1}
          defaultValue={initial.capacity}
          required
        />
      </div>
      <FormActions pending={action.pending} submitLabel={submitLabel} onCancel={onCancel} />
    </form>
  );
}
