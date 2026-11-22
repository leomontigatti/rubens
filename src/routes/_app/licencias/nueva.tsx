import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { EntryForm } from "#/components/range-entry.tsx";
import { readRangeEntry } from "#/components/range-entry-values.ts";
import { timeOffInputSchema } from "#/lib/time-ranges.ts";
import type { SchedulePractitioner } from "#/organization/practitioners.ts";
import { addTimeOff, getTimeOff } from "#/server/time-off.functions.ts";

import { refusalMessages } from "#/routes/_app/licencias/-shared.ts";
import { fixedCrumbs } from "#/components/app-breadcrumbs.tsx";

export const Route = createFileRoute("/_app/licencias/nueva")({
  head: () => ({ meta: [{ title: "Nueva licencia · underthing" }] }),
  loader: () => getTimeOff(),
  staticData: { crumbs: fixedCrumbs("Nueva licencia") },
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
      description="Los días u horas en que un profesional no atiende."
      subject="timeOff"
      initial={null}
      submitLabel="Crear licencia"
      creates
      owner={practitionerField(result.practitioners)}
      messages={refusalMessages}
      onSubmit={(values, notice) => {
        const input = timeOffInputSchema.safeParse({
          practitionerId: values.owner,
          entry: readRangeEntry(values),
          ...notice,
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
    initial: practitioners.length === 1 ? (practitioners[0]?.id ?? "") : "",
    placeholder: "Elegí un profesional",
    options: practitioners.map((practitioner) => ({
      value: practitioner.id,
      label: practitioner.displayName,
    })),
  };
}
