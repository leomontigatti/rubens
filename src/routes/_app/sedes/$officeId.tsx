import { BuildingIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import * as z from "zod";

import { EmptyState } from "#/components/empty-state.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Field, FieldLabel } from "#/components/ui/field.tsx";
import { capacityLabel, roomUpdateSchema } from "#/lib/offices.ts";
import {
  addRoom,
  changeRoomActive,
  getRoomUpcomingCount,
  editRoom,
  getOfficeWithRooms,
} from "#/server/offices.functions.ts";
import type { Office, Room } from "#/server/offices.ts";
import {
  AdminControls,
  ErrorAlert,
  FormActions,
  fieldMessage,
  NameField,
} from "#/components/admin-form.tsx";
import { CreateSheet, FormSheet } from "#/components/form-sheet.tsx";

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
      <CreateSheet canCreate={isAdmin && result.office.active} label="Nuevo consultorio">
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
      </CreateSheet>
      <RoomList rooms={result.rooms} isAdmin={isAdmin} canAdd={isAdmin && result.office.active} />
    </div>
  );
}

function OfficeHeading({ office }: { office: Office }) {
  return (
    <PageHeader
      back={{ to: "/sedes", label: "Sedes" }}
      title={office.name}
      status={!office.active && <Badge variant="secondary">Inactiva</Badge>}
      description={
        <p className="text-muted-foreground text-sm">
          {office.address} · {office.timeZone}
        </p>
      }
    />
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

function RoomList(props: { rooms: Room[]; isAdmin: boolean; canAdd: boolean }) {
  const { rooms, isAdmin } = props;
  const { inactivos } = Route.useSearch();
  if (rooms.length === 0) {
    return (
      <EmptyState
        icon={BuildingIcon}
        title="No hay consultorios para mostrar"
        description={`Agregá uno con Nuevo consultorio${inactivos ? "" : ", o mirá los inactivos"}.`}
        canAct={props.canAdd}
      />
    );
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

  return (
    <li>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 font-medium">
              {room.name}
              {!room.active && <Badge variant="secondary">Inactivo</Badge>}
            </span>
            <span className="text-muted-foreground text-sm">{capacityLabel(room.capacity)}</span>
          </div>
          <AdminControls
            isAdmin={isAdmin}
            active={room.active}
            onEdit={() => setEditing(true)}
            deactivation={{
              question: `¿Desactivar ${room.name}?`,
              countUpcoming: () => getRoomUpcomingCount({ data: { id: room.id } }),
            }}
            onToggleActive={() =>
              void toggle.run(() =>
                changeRoomActive({ data: { id: room.id, active: !room.active } }),
              )
            }
          />
          <ErrorAlert message={toggle.error} />
        </CardContent>
      </Card>
      <FormSheet open={editing} onClose={() => setEditing(false)} title="Editar consultorio">
        <RoomForm
          idPrefix={room.id}
          initial={room}
          submitLabel="Guardar"
          onCancel={() => setEditing(false)}
          onSubmit={(fields) => editRoom({ data: { ...fields, roomId: room.id } })}
          onDone={() => setEditing(false)}
        />
      </FormSheet>
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
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <ErrorAlert message={action.error} />
      <NameField idPrefix={idPrefix} initial={initial.name} />
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-capacity`}>Capacidad (profesionales a la vez)</FieldLabel>
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
      </Field>
      <FormActions pending={action.pending} submitLabel={submitLabel} onCancel={onCancel} />
    </form>
  );
}
