import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { EntryForm, readRangeEntry } from "#/components/range-entry.tsx";
import { Field, FieldLabel } from "#/components/ui/field.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import { timeOffInputSchema } from "#/lib/time-ranges.ts";
import type { SchedulePractitioner } from "#/server/schedules.ts";
import { addTimeOff, getTimeOff } from "#/server/time-off.functions.ts";

import { refusalMessages } from "#/routes/_app/licencias/-shared.ts";

export const Route = createFileRoute("/_app/licencias/nueva")({
  head: () => ({ meta: [{ title: "Nueva licencia · Rubens" }] }),
  loader: () => getTimeOff(),
  component: NewTimeOff,
});

function NewTimeOff() {
  const result = Route.useLoaderData();
  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  if (result.practitioners.length === 0) {
    return <RefusalMessage message={refusalMessages.forbidden} />;
  }
  return (
    <EntryForm
      back={{ to: "/licencias" }}
      title="Nueva licencia"
      initial={null}
      submitLabel="Crear licencia"
      messages={refusalMessages}
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
  );
}

/** The practitioners the actor may record time off for; a practitioner sees only themself. */
function PractitionerSelect(props: { practitioners: SchedulePractitioner[] }) {
  const only = props.practitioners.length === 1 ? props.practitioners[0]!.id : "";
  return (
    <Field>
      <FieldLabel htmlFor="new-practitionerId">Profesional</FieldLabel>
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
    </Field>
  );
}
