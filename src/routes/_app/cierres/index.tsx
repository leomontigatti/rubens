import { createFileRoute } from "@tanstack/react-router";

import { CreatePanel, RefusalMessage } from "#/components/admin-form.tsx";
import { EntryForm, EntryItem, readRangeEntry } from "#/components/range-entry.tsx";
import { Label } from "#/components/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import {
  closureInputSchema,
  closureOfficeOptions,
  closureUpdateSchema,
} from "#/lib/time-ranges.ts";
import {
  addClosure,
  editClosure,
  getClosures,
  removeClosure,
} from "#/server/closures.functions.ts";
import type { OfficeOption } from "#/server/closures.ts";

export const Route = createFileRoute("/_app/cierres/")({
  head: () => ({ meta: [{ title: "Cierres · Rubens" }] }),
  loader: () => getClosures(),
  component: ClosureList,
});

/** The copy for every refusal the closure server functions return. */
const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador puede cambiar cierres.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "No encontramos esa sede o ese cierre.",
};

const wholeOrganization = "Toda la organización";

/** The office field: empty for the whole organization. */
function readOfficeId(form: FormData): string | null {
  const officeId = form.get("officeId") as string;
  return officeId === "" ? null : officeId;
}

function ClosureList() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Cierres</h1>
      <CreatePanel isAdmin={result.canEdit} label="Nuevo cierre">
        {(close) => (
          <EntryForm
            idPrefix="new"
            initial={null}
            submitLabel="Crear cierre"
            messages={refusalMessages}
            onDone={close}
            onSubmit={(form) => {
              const input = closureInputSchema.safeParse({
                officeId: readOfficeId(form),
                entry: readRangeEntry(form),
              });
              return input.success ? addClosure({ data: input.data }) : input.error;
            }}
          >
            <OfficeSelect idPrefix="new" offices={result.offices} initial={null} />
          </EntryForm>
        )}
      </CreatePanel>
      {result.closures.length === 0 ? (
        <p className="text-muted-foreground">Todavía no hay cierres.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {result.closures.map((item) => (
            <EntryItem
              key={item.id}
              title={item.officeName ?? wholeOrganization}
              deleteQuestion="¿Eliminar este cierre?"
              entry={item.entry}
              canEdit={result.canEdit}
              messages={refusalMessages}
              onDelete={() => removeClosure({ data: { closureId: item.id } })}
              renderEdit={(close) => (
                <EntryForm
                  idPrefix={item.id}
                  initial={item.entry}
                  submitLabel="Guardar"
                  messages={refusalMessages}
                  onDone={close}
                  onSubmit={(form) => {
                    const input = closureUpdateSchema.safeParse({
                      closureId: item.id,
                      officeId: readOfficeId(form),
                      entry: readRangeEntry(form),
                    });
                    return input.success ? editClosure({ data: input.data }) : input.error;
                  }}
                >
                  <OfficeSelect
                    idPrefix={item.id}
                    offices={closureOfficeOptions(result.offices, item)}
                    initial={item.officeId}
                  />
                </EntryForm>
              )}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function OfficeSelect(props: {
  idPrefix: string;
  offices: OfficeOption[];
  initial: string | null;
}) {
  const id = `${props.idPrefix}-officeId`;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Sede</Label>
      <NativeSelect id={id} name="officeId" defaultValue={props.initial ?? ""}>
        <NativeSelectOption value="">{wholeOrganization}</NativeSelectOption>
        {props.offices.map((office) => (
          <NativeSelectOption key={office.id} value={office.id}>
            {office.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
