import { createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { EntryForm } from "#/components/range-entry.tsx";
import { readRangeEntry } from "#/components/range-entry-values.ts";
import { closureOfficeOptions, closureUpdateSchema } from "#/lib/time-ranges.ts";
import { editClosure, getClosures, removeClosure } from "#/server/closures.functions.ts";

import {
  closurePlace,
  officeField,
  readOfficeId,
  refusalMessages,
} from "#/routes/_app/cierres/-closure-fields.tsx";

export const Route = createFileRoute("/_app/cierres/$closureId")({
  head: () => ({ meta: [{ title: "Editar cierre · underthing" }] }),
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
      description={closurePlace(closure)}
      subject="closure"
      initial={closure.entry}
      submitLabel="Guardar"
      owner={officeField(closureOfficeOptions(result.offices, closure), closure.officeId)}
      messages={refusalMessages}
      deletion={{
        question: "¿Eliminar este cierre?",
        notice: "El cierre se borra y no se puede recuperar.",
        onDelete: () => removeClosure({ data: { closureId } }),
      }}
      onSubmit={(values, notice) => {
        const input = closureUpdateSchema.safeParse({
          closureId,
          officeId: readOfficeId(values.owner),
          entry: readRangeEntry(values),
          ...notice,
        });
        return input.success ? editClosure({ data: input.data }) : input.error;
      }}
    />
  );
}
