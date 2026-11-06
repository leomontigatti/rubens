import { StethoscopeIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { DataTable, NoMatches, RowLink, useClientDataTable } from "#/components/data-table.tsx";
import type { DataTableColumn } from "#/components/data-table.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { CreateButton } from "#/components/form-page.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { getMedicalServices } from "#/server/medical-services.functions.ts";
import type { MedicalService } from "#/organization/medical-services.ts";

import { refusalMessages } from "#/routes/_app/prestaciones/-shared.ts";

export const Route = createFileRoute("/_app/prestaciones/$practitionerId")({
  loader: ({ params }) =>
    getMedicalServices({
      data: { practitionerId: params.practitionerId, includeInactive: true },
    }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.ok
          ? `Prestaciones de ${loaderData.practitioner.displayName} · Rubens`
          : "Prestaciones · Rubens",
      },
    ],
  }),
  component: PractitionerMedicalServices,
});

function PractitionerMedicalServices() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  const { practitioner, medicalServices, canEdit } = result;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ to: "/prestaciones", label: "Prestaciones" }}
        title={practitioner.displayName}
      />
      <CreateButton
        can={canEdit}
        link={
          <Link
            to="/prestaciones/$practitionerId/nueva"
            params={{ practitionerId: practitioner.id }}
          />
        }
      >
        Nueva prestación
      </CreateButton>
      <MedicalServiceTable
        practitionerId={practitioner.id}
        medicalServices={medicalServices}
        canEdit={canEdit}
      />
    </div>
  );
}

/** A medical service in the list, its practitioner, and whether the viewer may open its page. */
type ListedMedicalService = MedicalService & { practitionerId: string; canOpen: boolean };

const columns: DataTableColumn<ListedMedicalService>[] = [
  {
    id: "name",
    header: "Nombre",
    cell: (medicalService) =>
      medicalService.canOpen ? (
        <RowLink
          to="/prestaciones/$practitionerId/$medicalServiceId"
          params={{
            practitionerId: medicalService.practitionerId,
            medicalServiceId: medicalService.id,
          }}
        >
          {medicalService.name}
        </RowLink>
      ) : (
        medicalService.name
      ),
  },
  {
    id: "duration",
    header: "Duración",
    cell: (medicalService) => `${medicalService.durationMinutes} min`,
  },
  {
    id: "status",
    header: "Estado",
    cell: (medicalService) => !medicalService.active && <Badge variant="secondary">Inactiva</Badge>,
  },
];

function MedicalServiceTable(props: {
  practitionerId: string;
  medicalServices: MedicalService[];
  canEdit: boolean;
}) {
  const { practitionerId, medicalServices, canEdit } = props;
  const { table, pager, query, setQuery } = useClientDataTable({
    rows: medicalServices.map((medicalService) => ({
      ...medicalService,
      practitionerId,
      canOpen: canEdit,
    })),
    columns,
    getRowId: (medicalService) => medicalService.id,
    searchText: (medicalService) => medicalService.name,
  });

  return (
    <DataTable
      table={table}
      pager={pager}
      search={{
        value: query,
        onChange: setQuery,
        label: "Buscar prestación",
        placeholder: "Buscar por nombre",
      }}
      empty={
        medicalServices.length === 0 ? (
          <EmptyState
            icon={StethoscopeIcon}
            title="Todavía no tiene prestaciones"
            description="Agregá la primera con Nueva prestación."
            canAct={canEdit}
          />
        ) : (
          <NoMatches icon={StethoscopeIcon} />
        )
      }
    />
  );
}
