import { ShieldIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import * as z from "zod";

import {
  AdminControls,
  ErrorAlert,
  FormActions,
  NameField,
  RefusalMessage,
  fieldMessage,
  useFormAction,
} from "#/components/admin-form.tsx";
import { CreateSheet, FormSheet } from "#/components/form-sheet.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { Field, FieldLabel } from "#/components/ui/field.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import { insurerInputSchema, insurerKindLabels, insurerKinds } from "#/lib/coverages.ts";
import type { InsurerInput } from "#/lib/coverages.ts";
import {
  addInsurer,
  changeInsurerActive,
  editInsurer,
  getInsurers,
} from "#/server/insurers.functions.ts";
import type { Insurer } from "#/server/insurers.ts";

export const Route = createFileRoute("/_app/obras-sociales/")({
  head: () => ({ meta: [{ title: "Obras sociales y prepagas · Rubens" }] }),
  validateSearch: z.object({ inactivas: z.boolean().optional() }),
  loaderDeps: ({ search }) => ({ includeInactive: search.inactivas ?? false }),
  loader: ({ deps }) => getInsurers({ data: deps }),
  component: Insurers,
});

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador puede cambiar las obras sociales y prepagas.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "No encontramos esa obra social o prepaga.",
  nameTaken: "Ya hay una obra social o prepaga con ese nombre.",
};

type ActionResult = { ok: true } | { ok: false; reason: keyof typeof refusalMessages };

const fieldMessages: Record<keyof InsurerInput, string> = {
  name: "Ingresá el nombre.",
  kind: "Elegí si es una obra social o una prepaga.",
};

const newInsurer: InsurerInput = { name: "", kind: "obraSocial" };

function useAction() {
  return useFormAction(refusalMessages);
}

function Insurers() {
  const { viewer } = Route.useRouteContext();
  const result = Route.useLoaderData();
  const isAdmin = viewer.roles.includes("admin");

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Obras sociales y prepagas" actions={<ShowInactiveInsurers />} />
      <CreateSheet canCreate={isAdmin} label="Nueva obra social o prepaga">
        {(close) => (
          <InsurerForm
            idPrefix="new"
            initial={newInsurer}
            submitLabel="Crear"
            onCancel={close}
            onSubmit={(input) => addInsurer({ data: input })}
            onDone={close}
          />
        )}
      </CreateSheet>
      <InsurerList insurers={result.insurers} isAdmin={isAdmin} />
    </div>
  );
}

function ShowInactiveInsurers() {
  const { inactivas } = Route.useSearch();
  return (
    <Button
      variant="outline"
      nativeButton={false}
      render={<Link to="/obras-sociales" search={{ inactivas: inactivas ? undefined : true }} />}
    >
      {inactivas ? "Ocultar inactivas" : "Mostrar inactivas"}
    </Button>
  );
}

function InsurerList({ insurers, isAdmin }: { insurers: Insurer[]; isAdmin: boolean }) {
  const { inactivas } = Route.useSearch();
  if (insurers.length === 0) {
    return (
      <EmptyState
        icon={ShieldIcon}
        title="No hay obras sociales ni prepagas para mostrar"
        description={`Agregá una con Nueva obra social o prepaga${inactivas ? "" : ", o mirá las inactivas"}.`}
        canAct={isAdmin}
      />
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {insurers.map((insurer) => (
        <InsurerItem key={insurer.id} insurer={insurer} isAdmin={isAdmin} />
      ))}
    </ul>
  );
}

function InsurerItem({ insurer, isAdmin }: { insurer: Insurer; isAdmin: boolean }) {
  const [editing, setEditing] = useState(false);
  const toggle = useAction();

  return (
    <li>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 font-medium">
              {insurer.name}
              {!insurer.active && <Badge variant="secondary">Inactiva</Badge>}
            </span>
            <span className="text-muted-foreground text-sm">{insurerKindLabels[insurer.kind]}</span>
          </div>
          <AdminControls
            isAdmin={isAdmin}
            active={insurer.active}
            onEdit={() => setEditing(true)}
            onToggleActive={() =>
              void toggle.run(() =>
                changeInsurerActive({ data: { id: insurer.id, active: !insurer.active } }),
              )
            }
          />
          <ErrorAlert message={toggle.error} />
        </CardContent>
      </Card>
      <FormSheet
        open={editing}
        onClose={() => setEditing(false)}
        title="Editar obra social o prepaga"
      >
        <InsurerForm
          idPrefix={insurer.id}
          initial={insurer}
          submitLabel="Guardar"
          onCancel={() => setEditing(false)}
          onSubmit={(input) => editInsurer({ data: { ...input, insurerId: insurer.id } })}
          onDone={() => setEditing(false)}
        />
      </FormSheet>
    </li>
  );
}

interface InsurerFormProps {
  idPrefix: string;
  initial: InsurerInput;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (input: InsurerInput) => Promise<ActionResult>;
  onDone: () => void;
}

function InsurerForm({
  idPrefix,
  initial,
  submitLabel,
  onCancel,
  onSubmit,
  onDone,
}: InsurerFormProps) {
  const action = useAction();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = insurerInputSchema.safeParse({ name: form.get("name"), kind: form.get("kind") });
    if (!input.success) {
      action.setError(fieldMessage(fieldMessages, input.error));
      return;
    }
    if (await action.run(() => onSubmit(input.data))) {
      onDone();
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <ErrorAlert message={action.error} />
      <NameField idPrefix={idPrefix} initial={initial.name} />
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-kind`}>Tipo</FieldLabel>
        <NativeSelect id={`${idPrefix}-kind`} name="kind" defaultValue={initial.kind}>
          {insurerKinds.map((kind) => (
            <NativeSelectOption key={kind} value={kind}>
              {insurerKindLabels[kind]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <FormActions pending={action.pending} submitLabel={submitLabel} onCancel={onCancel} />
    </form>
  );
}
