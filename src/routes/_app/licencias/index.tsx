import { TreePalmIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { EmptyState } from "#/components/empty-state.tsx";
import { RefusalMessage } from "#/components/admin-form.tsx";
import { CreateButton } from "#/components/form-page.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { EntryItem } from "#/components/range-entry.tsx";
import { getTimeOff, removeTimeOff } from "#/server/time-off.functions.ts";

import { refusalMessages } from "#/routes/_app/licencias/-shared.ts";

export const Route = createFileRoute("/_app/licencias/")({
  head: () => ({ meta: [{ title: "Licencias · Rubens" }] }),
  loader: () => getTimeOff(),
  component: TimeOffList,
});

function TimeOffList() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Licencias" />
      <CreateButton can={result.practitioners.length > 0} link={<Link to="/licencias/nueva" />}>
        Nueva licencia
      </CreateButton>
      {result.timeOff.length === 0 ? (
        <EmptyState
          icon={TreePalmIcon}
          title="Todavía no hay licencias"
          description="Agregá la primera con Nueva licencia."
          canAct={result.practitioners.length > 0}
        />
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
              editLink={<Link to="/licencias/$timeOffId" params={{ timeOffId: item.id }} />}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
