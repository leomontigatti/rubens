import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { EntryForm, readRangeEntry } from "#/components/range-entry.tsx";
import { closureOfficeOptions, closureUpdateSchema } from "#/lib/time-ranges.ts";
import { editClosure, getClosures } from "#/server/closures.functions.ts";

import {
  OfficeSelect,
  readOfficeId,
  refusalMessages,
} from "#/routes/_app/cierres/-closure-fields.tsx";

export const Route = createFileRoute("/_app/cierres/$closureId")({
  head: () => ({ meta: [{ title: "Editar cierre · Rubens" }] }),
  loader: () => getClosures(),
  component: EditClosure,
});

function EditClosure() {
  const result = Route.useLoaderData();
  const { closureId } = Route.useParams();
  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  const closure = result.closures.find((one) => one.id === closureId);
  if (!closure) {
    return <RefusalMessage message={refusalMessages.notFound} />;
  }
  if (!result.canEdit) {
    return <RefusalMessage message={refusalMessages.forbidden} />;
  }
  return (
    <EntryForm
      back={{ to: "/cierres" }}
      title="Editar cierre"
      initial={closure.entry}
      submitLabel="Guardar"
      messages={refusalMessages}
      onSubmit={(form) => {
        const input = closureUpdateSchema.safeParse({
          closureId,
          officeId: readOfficeId(form),
          entry: readRangeEntry(form),
        });
        return input.success ? editClosure({ data: input.data }) : input.error;
      }}
    >
      <OfficeSelect
        offices={closureOfficeOptions(result.offices, closure)}
        initial={closure.officeId}
      />
    </EntryForm>
  );
}
