import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { EntryForm, readRangeEntry } from "#/components/range-entry.tsx";
import { NativeSelectOption } from "#/components/ui/native-select.tsx";
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
      owner={practitionerField(result.practitioners)}
      messages={refusalMessages}
      onSubmit={(values) => {
        const input = timeOffInputSchema.safeParse({
          practitionerId: values.owner,
          entry: readRangeEntry(values),
        });
        return input.success ? addTimeOff({ data: input.data }) : input.error;
      }}
    />
  );
}

/** The practitioners the actor may record time off for; a practitioner sees only themself. */
function practitionerField(practitioners: SchedulePractitioner[]) {
  return {
    label: "Profesional",
    required: true,
    initial: practitioners.length === 1 ? practitioners[0]!.id : "",
    options: (
      <>
        <NativeSelectOption value="" disabled>
          Elegí un profesional
        </NativeSelectOption>
        {practitioners.map((practitioner) => (
          <NativeSelectOption key={practitioner.id} value={practitioner.id}>
            {practitioner.displayName}
          </NativeSelectOption>
        ))}
      </>
    ),
  };
}
