import { createFileRoute } from "@tanstack/react-router";

import { pageHead } from "#/lib/page-title.ts";
import { RefusalMessage } from "#/components/admin-form.tsx";
import { EntryForm } from "#/components/range-entry.tsx";
import { readRangeEntry } from "#/components/range-entry-values.ts";
import { closureUpdateSchema, rangeEntryLabel } from "#/lib/time-ranges.ts";
import { editClosure, getClosures, removeClosure } from "#/server/closures.functions.ts";

import { refusalMessages } from "#/routes/_app/cierres/-closure-fields.tsx";
import { fixedCrumbs } from "#/components/app-breadcrumbs.tsx";

export const Route = createFileRoute("/_app/cierres/$closureId")({
  head: ({ loaderData, params }) => {
    const closure = loaderData?.ok
      ? loaderData.closures.find((one) => one.id === params.closureId)
      : undefined;
    return pageHead(closure ? rangeEntryLabel(closure.entry) : "Cierre");
  },
  loader: () => getClosures(),
  staticData: { crumbs: fixedCrumbs("Editar cierre") },
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
      title={rangeEntryLabel(closure.entry)}
      description="Los días u horas en que no se atiende."
      transitionId={closureId}
      subject="closure"
      initial={closure.entry}
      submitLabel="Guardar"
      messages={refusalMessages}
      deletion={{
        question: "¿Eliminar este cierre?",
        notice: "El cierre se borra y no se puede recuperar.",
        onDelete: () => removeClosure({ data: { closureId } }),
      }}
      onSubmit={(values, notice) => {
        const input = closureUpdateSchema.safeParse({
          closureId,
          entry: readRangeEntry(values),
          ...notice,
        });
        return input.success ? editClosure({ data: input.data }) : input.error;
      }}
    />
  );
}
