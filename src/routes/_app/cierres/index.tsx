import { CalendarXIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { EmptyState } from "#/components/empty-state.tsx";
import { RefusalMessage } from "#/components/admin-form.tsx";
import { CreateButton } from "#/components/form-page.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { EntryItem } from "#/components/range-entry.tsx";
import { getClosures, removeClosure } from "#/server/closures.functions.ts";

import { refusalMessages, wholeOrganization } from "#/routes/_app/cierres/-closure-fields.tsx";

export const Route = createFileRoute("/_app/cierres/")({
  head: () => ({ meta: [{ title: "Cierres · Rubens" }] }),
  loader: () => getClosures(),
  component: ClosureList,
});

function ClosureList() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Cierres" />
      <CreateButton can={result.canEdit} link={<Link to="/cierres/nuevo" />}>
        Nuevo cierre
      </CreateButton>
      {result.closures.length === 0 ? (
        <EmptyState
          icon={CalendarXIcon}
          title="Todavía no hay cierres"
          description="Agregá el primero con Nuevo cierre."
          canAct={result.canEdit}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {result.closures.map((item) => (
            <EntryItem
              key={item.id}
              title={item.officeName ?? wholeOrganization}
              deleteQuestion="¿Eliminar este cierre?"
              deleteNotice="El cierre se borra y no se puede recuperar."
              entry={item.entry}
              canEdit={result.canEdit}
              messages={refusalMessages}
              onDelete={() => removeClosure({ data: { closureId: item.id } })}
              editLink={<Link to="/cierres/$closureId" params={{ closureId: item.id }} />}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
