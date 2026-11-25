// PROTOTYPE (LEO-6), never merged: the three variants of the single office's
// settings page, with the room dialog and the office form they share. Every
// save goes to the in-memory store (`-prototype-store.ts`), never to the server.

import { DoorOpenIcon, PencilIcon, PowerIcon, PowerOffIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";
import * as z from "zod";

import { ActionsMenu, ArchivedBadge } from "#/components/admin-form.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { useDeactivation } from "#/components/confirm-dialog.tsx";
import { DataTable, NoMatches, RowName, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { archivedFilter, includesArchivedPick } from "#/components/filter-groups.ts";
import { FormDialog, useFormDialog } from "#/components/form-dialog.tsx";
import type { FormDialogControl } from "#/components/form-dialog.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { CreateButton, FormPage, useFormPage } from "#/components/form-page.tsx";
import type { RecordHeader } from "#/components/form-page.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Detail, RecordSection } from "#/components/record-section.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { DropdownMenuItem } from "#/components/ui/dropdown-menu.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs.tsx";
import { officeInputSchema } from "#/lib/offices.ts";

import {
  prototypeActions,
  timeZoneLabel,
  timeZoneOptions,
  usePrototype,
} from "#/routes/_app/sedes/-prototype-store.ts";
import type { PrototypeRoom, Variant } from "#/routes/_app/sedes/-prototype-store.ts";

/** What a variant needs from its route: who looks, and the list's archived filter. */
export interface VariantProps {
  canEdit: boolean;
  archivados: boolean;
  onArchivados: (included: boolean | undefined) => void;
}

/** A pattern no screen uses today, marked so it is judged knowingly. */
function NewBadge() {
  return <Badge variant="warning">Nuevo</Badge>;
}

// Variant A: `Pestañas`

/**
 * A: the office is a record page, as `/sedes/$officeId` is today: titled by its
 * name, with `Datos generales` (the form) and `Consultorios` tabs, and
 * `Acciones` holding only `Nuevo consultorio`, since the office cannot be archived.
 */
export function VariantA(props: VariantProps) {
  const { office, rooms, saves } = usePrototype();
  const roomDialog = useRoomDialog(rooms);
  const [tab, setTab] = useState("datos");
  const activeRooms = rooms.filter((room) => room.active).length;
  const roomList = (
    <RoomList
      {...props}
      onOpen={props.canEdit ? roomDialog.edit : undefined}
      onCreate={props.canEdit ? roomDialog.create : undefined}
    />
  );
  if (!props.canEdit) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={office.name} description={office.address} />
        {roomList}
      </div>
    );
  }
  const record: RecordHeader = {
    error: null,
    actions: (busy) => (
      <ActionsMenu disabled={busy}>
        <DropdownMenuItem onClick={roomDialog.create}>Nuevo consultorio</DropdownMenuItem>
      </ActionsMenu>
    ),
  };
  return (
    <OfficeForm
      key={saves}
      variant="A"
      stays
      title={office.name}
      description="Los datos de la sede y los consultorios donde se atiende."
      record={record}
      frame={(form) => (
        <>
          <Tabs value={tab} onValueChange={(value: string) => setTab(value)}>
            <TabsList className="w-full">
              <TabsTrigger value="datos">Datos generales</TabsTrigger>
              <TabsTrigger value="consultorios">
                Consultorios
                <Badge variant="outline">{activeRooms}</Badge>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="datos" keepMounted>
              {form}
            </TabsContent>
            <TabsContent value="consultorios">{roomList}</TabsContent>
          </Tabs>
          {roomDialog.dialog}
        </>
      )}
    />
  );
}

// Variant B: `Secciones`

/**
 * B: a settings page, as `/whatsapp/configuracion`: a `Datos de la sede`
 * section showing its values, whose `Editar` opens the office's form page,
 * then a `Consultorios` section holding the room list, created and edited in
 * the room dialog.
 */
export function VariantB(props: VariantProps) {
  const { rooms } = usePrototype();
  const roomDialog = useRoomDialog(rooms);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Sede" description="Dónde se atiende y en qué consultorios." />
      <RecordSection
        title="Datos de la sede"
        action={props.canEdit && <EditOfficeButton variant="B" label="Editar" />}
      >
        <OfficeDetails />
      </RecordSection>
      <RecordSection
        title="Consultorios"
        action={
          props.canEdit && (
            <span className="flex items-center gap-2">
              <NewBadge />
              <CreateButton onClick={roomDialog.create}>Nuevo consultorio</CreateButton>
            </span>
          )
        }
      >
        <RoomList
          {...props}
          onOpen={props.canEdit ? roomDialog.edit : undefined}
          onCreate={props.canEdit ? roomDialog.create : undefined}
        />
      </RecordSection>
      {roomDialog.dialog}
    </div>
  );
}

/** The office's values, as a settings section shows them. */
function OfficeDetails() {
  const { office } = usePrototype();
  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      <Detail label="Nombre" value={office.name} />
      <Detail label="Domicilio" value={office.address} />
      <Detail label="Zona horaria" value={timeZoneLabel(office.timeZone)} />
    </dl>
  );
}

function EditOfficeButton(props: { variant: Variant; label: string }) {
  return (
    <Button
      variant="outline"
      nativeButton={false}
      render={<Link to="/sedes/editar" search={{ variant: props.variant }} />}
    >
      <PencilIcon data-icon="inline-start" aria-hidden />
      {props.label}
    </Button>
  );
}

// Variant C: `Consultorios primero`

/**
 * C: the rooms are the page, a list page like any other titled
 * `Consultorios`; the office is the line under the title, and its form opens
 * from `Datos de la sede` beside `Nuevo consultorio`.
 */
export function VariantC(props: VariantProps) {
  const { office, rooms } = usePrototype();
  const roomDialog = useRoomDialog(rooms);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Consultorios"
        description={
          <p className="text-muted-foreground text-sm">
            {office.name}, {office.address}. Hora de {timeZoneLabel(office.timeZone)}.
          </p>
        }
        actions={
          props.canEdit && (
            <>
              <NewBadge />
              <EditOfficeButton variant="C" label="Datos de la sede" />
              <CreateButton onClick={roomDialog.create}>Nuevo consultorio</CreateButton>
            </>
          )
        }
      />
      <RoomList
        {...props}
        onOpen={props.canEdit ? roomDialog.edit : undefined}
        onCreate={props.canEdit ? roomDialog.create : undefined}
      />
      {roomDialog.dialog}
    </div>
  );
}

// What the variants share.

const officeMessages = {
  name: "Ingresá el nombre de la sede.",
  address: "Ingresá el domicilio de la sede.",
  timeZone: "Elegí la zona horaria de la sede.",
};

/** Nothing is refused by a stub, and nothing waits on one. */
const stubAction = { pending: false, error: null, errorField: "", setError: () => {} };

/**
 * The office's one form: name and address side by side, the time zone on a
 * row of its own. On A it stays on the page once saved; on B and C, a page of
 * its own, it goes back.
 */
export function OfficeForm(props: {
  variant: Variant;
  stays?: boolean;
  title: string;
  description: string;
  record?: RecordHeader;
  frame?: (content: ReactNode) => ReactNode;
}) {
  const { office } = usePrototype();
  const page = useFormPage({ to: "/sedes", search: { variant: props.variant } });
  const form = useAppForm({
    defaultValues: { ...office },
    onSubmit: ({ value }) => {
      const input = officeInputSchema.safeParse(value);
      if (!input.success) {
        page.showProblems(fieldProblems(input.error.issues, messageIn(officeMessages)));
        return;
      }
      if (!props.stays) {
        page.leave();
      }
      prototypeActions.saveOffice({ ...input.data, timeZone: input.data.timeZone });
    },
  });
  return (
    <FormPage
      page={page}
      form={form}
      title={props.title}
      description={props.description}
      submitLabel="Guardar"
      pending={false}
      onClear={() => {}}
      record={props.record}
      frame={props.frame}
    >
      <form.AppField name="name">
        {(field) => <field.TextField label="Nombre" size="half" required />}
      </form.AppField>
      <form.AppField name="address">
        {(field) => (
          <field.TextField
            label="Domicilio"
            size="half"
            placeholder="Av. Colón 1234, Córdoba"
            required
          />
        )}
      </form.AppField>
      <form.AppField name="timeZone">
        {(field) => (
          <field.SelectField
            label="Zona horaria"
            size="half"
            startsRow
            hint="Los horarios, los turnos y los recordatorios se leen en esta hora."
            options={timeZoneOptions(office.timeZone)}
            required
          />
        )}
      </form.AppField>
    </FormPage>
  );
}

type ListedRoom = PrototypeRoom & { open?: () => void };

const roomColumns: DataTableColumn<ListedRoom>[] = [
  {
    id: "name",
    header: "Nombre",
    cell: (room) => (
      <RowName
        name={room.name}
        onOpen={room.open}
        status={<ArchivedBadge active={room.active} ending="o" />}
      />
    ),
  },
];

/** The office's rooms, active ones unless the filter adds the archived. */
function RoomList(
  props: VariantProps & { onOpen?: (room: PrototypeRoom) => void; onCreate?: () => void },
) {
  const { rooms } = usePrototype();
  const { onOpen } = props;
  const shown = props.archivados ? rooms : rooms.filter((room) => room.active);
  const { table, pager, query, setQuery } = useClientDataTable({
    rows: shown.map((room) => ({ ...room, open: onOpen && (() => onOpen(room)) })),
    columns: roomColumns,
    getRowId: (room) => room.id,
    searchText: (room) => room.name,
  });
  return (
    <DataTable
      table={table}
      pager={pager}
      search={{
        value: query,
        onChange: setQuery,
        label: "Buscar consultorio",
        placeholder: "Buscar por nombre",
      }}
      filters={{
        groups: [archivedFilter(props.archivados, { group: "Archivados", included: "Incluidos" })],
        onPick: (_id, value) => props.onArchivados(includesArchivedPick(value)),
        onRemove: () => props.onArchivados(undefined),
      }}
      noRecords={rooms.length === 0}
      empty={
        rooms.length === 0 ? (
          <EmptyState
            icon={DoorOpenIcon}
            title="Sin consultorios"
            description={`Todavía no hay consultorios.${props.onCreate ? " Empezá creando el primero." : ""}`}
          >
            {props.onCreate && (
              <CreateButton onClick={props.onCreate}>Nuevo consultorio</CreateButton>
            )}
          </EmptyState>
        ) : (
          <NoMatches icon={DoorOpenIcon} />
        )
      }
    />
  );
}

const roomSchema = z.object({ name: z.string().trim().min(1).max(200) });

/** The room dialog: `create` opens it empty, `edit` on a room. A room has only a name. */
function useRoomDialog(rooms: PrototypeRoom[]) {
  const dialog = useFormDialog();
  const [opening, setOpening] = useState<{ id: string | null; count: number }>({
    id: null,
    count: 0,
  });
  const open = (room: PrototypeRoom | null) => {
    setOpening(({ count }) => ({ id: room?.id ?? null, count: count + 1 }));
    dialog.show();
  };
  const room = rooms.find((one) => one.id === opening.id) ?? null;
  return {
    create: () => open(null),
    edit: open,
    dialog: <RoomDialog key={opening.count} dialog={dialog} room={room} />,
  };
}

function RoomDialog(props: { dialog: FormDialogControl; room: PrototypeRoom | null }) {
  const { dialog, room } = props;
  const form = useAppForm({
    defaultValues: { name: room?.name ?? "" },
    onSubmit: ({ value }) => {
      const fields = roomSchema.safeParse(value);
      if (!fields.success) {
        dialog.showProblems(
          fieldProblems(
            fields.error.issues,
            messageIn({ name: "Ingresá el nombre del consultorio." }),
          ),
        );
        return;
      }
      if (room) {
        prototypeActions.renameRoom(room.id, fields.data.name);
      } else {
        prototypeActions.addRoom(fields.data.name);
      }
      dialog.hide();
    },
  });
  const change = (active: boolean) => {
    if (room) {
      prototypeActions.setRoomActive(room.id, active);
      dialog.hide();
    }
  };
  const deactivate = useDeactivation(
    {
      question: `¿Archivar ${room?.name ?? ""}?`,
      countUpcoming: () => Promise.resolve({ ok: true as const, count: room?.upcoming ?? 0 }),
    },
    () => change(false),
  );
  return (
    <FormDialog
      dialog={dialog}
      form={form}
      action={stubAction}
      title={
        room ? (
          <>
            {room.name}
            <ArchivedBadge active={room.active} ending="o" />
          </>
        ) : (
          "Nuevo consultorio"
        )
      }
      description={room ? "El nombre del consultorio." : "Una sala de la sede donde se atiende."}
      submitLabel={room ? "Guardar" : "Crear consultorio"}
      question={deactivate.question}
      aside={
        room &&
        (room.active ? (
          <Button
            type="button"
            variant="destructive"
            disabled={deactivate.checking}
            onClick={deactivate.request}
          >
            <PowerOffIcon data-icon="inline-start" aria-hidden />
            Archivar
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={() => change(true)}>
            <PowerIcon data-icon="inline-start" aria-hidden />
            Restaurar
          </Button>
        ))
      }
    >
      <form.AppField name="name">
        {(field) => <field.TextField label="Nombre" required />}
      </form.AppField>
    </FormDialog>
  );
}
