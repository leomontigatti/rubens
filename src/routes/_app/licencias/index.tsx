import { createFileRoute } from "@tanstack/react-router";

import { CreatePanel, RefusalMessage } from "#/components/admin-form.tsx";
import { EntryForm, EntryItem, readRangeEntry } from "#/components/range-entry.tsx";
import { Label } from "#/components/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import { timeOffInputSchema, timeOffUpdateSchema } from "#/lib/time-ranges.ts";
import type { SchedulePractitioner } from "#/server/schedules.ts";
import { addTimeOff, editTimeOff, getTimeOff, removeTimeOff } from "#/server/time-off.functions.ts";

export const Route = createFileRoute("/_app/licencias/")({
  head: () => ({ meta: [{ title: "Licencias · Rubens" }] }),
  loader: () => getTimeOff(),
  component: TimeOffList,
});

/** The copy for every refusal the time-off server functions return. */
const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador o el propio profesional pueden cambiar sus licencias.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "No encontramos ese profesional o esa licencia.",
};

function TimeOffList() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Licencias</h1>
      <CreatePanel isAdmin={result.practitioners.length > 0} label="Nueva licencia">
        {(close) => (
          <EntryForm
            idPrefix="new"
            initial={null}
            submitLabel="Crear licencia"
            messages={refusalMessages}
            onDone={close}
            onSubmit={(form) => {
              const input = timeOffInputSchema.safeParse({
                practitionerId: form.get("practitionerId"),
                entry: readRangeEntry(form),
              });
              return input.success ? addTimeOff({ data: input.data }) : input.error;
            }}
          >
            <PractitionerSelect practitioners={result.practitioners} />
          </EntryForm>
        )}
      </CreatePanel>
      {result.timeOff.length === 0 ? (
        <p className="text-muted-foreground">Todavía no hay licencias.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {result.timeOff.map((item) => (
            <EntryItem
              key={item.id}
              title={item.practitionerName}
              deleteQuestion="¿Eliminar esta licencia?"
              deleteNotice="La licencia se borra y no se puede recuperar."
              entry={item.entry}
              canEdit={item.canEdit}
              messages={refusalMessages}
              onDelete={() => removeTimeOff({ data: { timeOffId: item.id } })}
              renderEdit={(close) => (
                <EntryForm
                  idPrefix={item.id}
                  initial={item.entry}
                  submitLabel="Guardar"
                  messages={refusalMessages}
                  onDone={close}
                  onSubmit={(form) => {
                    const input = timeOffUpdateSchema.safeParse({
                      timeOffId: item.id,
                      entry: readRangeEntry(form),
                    });
                    return input.success ? editTimeOff({ data: input.data }) : input.error;
                  }}
                />
              )}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The practitioners the actor may record time off for; a practitioner sees only themself. */
function PractitionerSelect(props: { practitioners: SchedulePractitioner[] }) {
  const only = props.practitioners.length === 1 ? props.practitioners[0]!.id : "";
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="new-practitionerId">Profesional</Label>
      <NativeSelect id="new-practitionerId" name="practitionerId" defaultValue={only} required>
        <NativeSelectOption value="" disabled>
          Elegí un profesional
        </NativeSelectOption>
        {props.practitioners.map((practitioner) => (
          <NativeSelectOption key={practitioner.id} value={practitioner.id}>
            {practitioner.displayName}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
