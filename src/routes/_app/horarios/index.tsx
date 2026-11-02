import { ClockIcon } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";

import { NoPractitioners } from "#/components/empty-state.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { PractitionerTable, practitionerColumns } from "#/components/practitioner-table.tsx";
import { getSchedulePractitioners } from "#/server/schedules.functions.ts";

import { RefusalAlert } from "#/routes/_app/horarios/-shared.tsx";

const columns = practitionerColumns("/horarios/$practitionerId");

export const Route = createFileRoute("/_app/horarios/")({
  head: () => ({ meta: [{ title: "Horarios · Rubens" }] }),
  loader: () => getSchedulePractitioners(),
  component: SchedulePractitioners,
});

function SchedulePractitioners() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Horarios" />
      {result.practitioners.length === 0 ? (
        <NoPractitioners />
      ) : (
        <PractitionerTable
          practitioners={result.practitioners}
          columns={columns}
          icon={ClockIcon}
        />
      )}
    </div>
  );
}
