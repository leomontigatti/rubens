import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import * as z from "zod";

import {
  AdminControls,
  CreatePanel,
  ErrorAlert,
  FormActions,
  RefusalMessage,
  fieldMessage,
  useFormAction,
} from "#/components/admin-form.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
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
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Obras sociales y prepagas</h1>
        <ShowInactiveInsurers />
      </div>
      <CreatePanel isAdmin={isAdmin} label="Nueva obra social o prepaga">
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
      </CreatePanel>
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
  if (insurers.length === 0) {
    return <p className="text-muted-foreground">Todavía no hay obras sociales ni prepagas.</p>;
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

  if (editing) {
    return (
      <li>
        <Card>
          <CardContent>
            <InsurerForm
              idPrefix={insurer.id}
              initial={insurer}
              submitLabel="Guardar"
              onCancel={() => setEditing(false)}
              onSubmit={(input) => editInsurer({ data: { ...input, insurerId: insurer.id } })}
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
            <span className="font-medium">{insurer.name}</span>
            <span className="text-muted-foreground text-sm">
              {insurerKindLabels[insurer.kind]}
              {!insurer.active && " · Inactiva"}
            </span>
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
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <ErrorAlert message={action.error} />
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-name`}>Nombre</Label>
        <Input id={`${idPrefix}-name`} name="name" defaultValue={initial.name} required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-kind`}>Tipo</Label>
        <NativeSelect id={`${idPrefix}-kind`} name="kind" defaultValue={initial.kind}>
          {insurerKinds.map((kind) => (
            <NativeSelectOption key={kind} value={kind}>
              {insurerKindLabels[kind]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <FormActions pending={action.pending} submitLabel={submitLabel} onCancel={onCancel} />
    </form>
  );
}
