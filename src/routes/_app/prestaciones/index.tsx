import { StethoscopeIcon } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";

import { NoPractitioners } from "#/components/empty-state.tsx";
import { RefusalMessage } from "#/components/admin-form.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { PractitionerTable, practitionerColumns } from "#/components/practitioner-table.tsx";
import { getMedicalServicePractitioners } from "#/server/medical-services.functions.ts";

import { refusalMessages } from "#/routes/_app/prestaciones/-shared.ts";

const columns = practitionerColumns("/prestaciones/$practitionerId");

export const Route = createFileRoute("/_app/prestaciones/")({
  head: () => ({ meta: [{ title: "Prestaciones · underthing" }] }),
  loader: () => getMedicalServicePractitioners(),
  component: MedicalServicePractitioners,
});

function MedicalServicePractitioners() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Prestaciones"
        description="Los tipos de consulta que ofrece cada profesional."
      />
      {result.practitioners.length === 0 ? (
        <NoPractitioners />
      ) : (
        <PractitionerTable
          practitioners={result.practitioners}
          columns={columns}
          icon={StethoscopeIcon}
        />
      )}
    </div>
  );
}
