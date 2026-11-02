import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { EntryForm, readRangeEntry } from "#/components/range-entry.tsx";
import { timeOffUpdateSchema } from "#/lib/time-ranges.ts";
import { editTimeOff, getTimeOff } from "#/server/time-off.functions.ts";

import { refusalMessages } from "#/routes/_app/licencias/-shared.ts";

export const Route = createFileRoute("/_app/licencias/$timeOffId")({
  head: () => ({ meta: [{ title: "Editar licencia · Rubens" }] }),
  loader: () => getTimeOff(),
  component: EditTimeOff,
});

function EditTimeOff() {
  const result = Route.useLoaderData();
  const { timeOffId } = Route.useParams();
  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  const item = result.timeOff.find((one) => one.id === timeOffId);
  if (!item) {
    return <RefusalMessage message={refusalMessages.notFound} />;
  }
  if (!item.canEdit) {
    return <RefusalMessage message={refusalMessages.forbidden} />;
  }
  return (
    <EntryForm
      back={{ to: "/licencias" }}
      title="Editar licencia"
      description={item.practitionerName}
      initial={item.entry}
      submitLabel="Guardar"
      messages={refusalMessages}
      onSubmit={(values) => {
        const input = timeOffUpdateSchema.safeParse({ timeOffId, entry: readRangeEntry(values) });
        return input.success ? editTimeOff({ data: input.data }) : input.error;
      }}
    />
  );
}
