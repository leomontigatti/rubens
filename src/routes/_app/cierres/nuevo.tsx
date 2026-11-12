import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { EntryForm, readRangeEntry } from "#/components/range-entry.tsx";
import { closureInputSchema } from "#/lib/time-ranges.ts";
import { addClosure, getClosures } from "#/server/closures.functions.ts";

import {
  officeField,
  readOfficeId,
  refusalMessages,
} from "#/routes/_app/cierres/-closure-fields.tsx";

export const Route = createFileRoute("/_app/cierres/nuevo")({
  head: () => ({ meta: [{ title: "Nuevo cierre · underthing" }] }),
  loader: () => getClosures(),
  component: NewClosure,
});

function NewClosure() {
  const result = Route.useLoaderData();
  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  if (!result.canEdit) {
    return <RefusalMessage message={refusalMessages.forbidden} />;
  }
  return (
    <EntryForm
      back={{ to: "/cierres" }}
      title="Nuevo cierre"
      subject="closure"
      initial={null}
      submitLabel="Crear cierre"
      creates
      owner={officeField(result.offices, null)}
      messages={refusalMessages}
      onSubmit={(values, notice) => {
        const input = closureInputSchema.safeParse({
          officeId: readOfficeId(values.owner),
          entry: readRangeEntry(values),
          ...notice,
        });
        return input.success ? addClosure({ data: input.data }) : input.error;
      }}
    />
  );
}
