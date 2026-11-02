import { BuildingIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { EmptyState } from "#/components/empty-state.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import {
  changeOfficeActive,
  getOfficeUpcomingCount,
  getOffices,
} from "#/server/offices.functions.ts";
import type { Office } from "#/server/offices.ts";
import { AdminControls, ErrorAlert } from "#/components/admin-form.tsx";

import { RefusalAlert, useAction } from "#/routes/_app/sedes/-shared.tsx";

export const Route = createFileRoute("/_app/sedes/")({
  head: () => ({ meta: [{ title: "Sedes · Rubens" }] }),
  validateSearch: z.object({ inactivas: z.boolean().optional() }),
  loaderDeps: ({ search }) => ({ includeInactive: search.inactivas ?? false }),
  loader: ({ deps }) => getOffices({ data: deps }),
  component: Offices,
});

function Offices() {
  const { viewer } = Route.useRouteContext();
  const result = Route.useLoaderData();
  const isAdmin = viewer.roles.includes("admin");

  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Sedes" actions={<ShowInactiveOffices />} />
      {isAdmin && (
        <div>
          <Button nativeButton={false} render={<Link to="/sedes/nueva" />}>
            Nueva sede
          </Button>
        </div>
      )}
      <OfficeList offices={result.offices} isAdmin={isAdmin} />
    </div>
  );
}

function ShowInactiveOffices() {
  const { inactivas } = Route.useSearch();
  return (
    <Button
      variant="outline"
      nativeButton={false}
      render={<Link to="/sedes" search={{ inactivas: inactivas ? undefined : true }} />}
    >
      {inactivas ? "Ocultar inactivas" : "Mostrar inactivas"}
    </Button>
  );
}

function OfficeList({ offices, isAdmin }: { offices: Office[]; isAdmin: boolean }) {
  const { inactivas } = Route.useSearch();
  if (offices.length === 0) {
    return (
      <EmptyState
        icon={BuildingIcon}
        title="No hay sedes para mostrar"
        description={`Agregá una con Nueva sede${inactivas ? "" : ", o mirá las inactivas"}.`}
        canAct={isAdmin}
      />
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {offices.map((office) => (
        <OfficeItem key={office.id} office={office} isAdmin={isAdmin} />
      ))}
    </ul>
  );
}

function OfficeItem({ office, isAdmin }: { office: Office; isAdmin: boolean }) {
  const navigate = Route.useNavigate();
  const toggle = useAction();

  return (
    <li>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Link
                to="/sedes/$officeId"
                params={{ officeId: office.id }}
                className="font-medium underline-offset-4 hover:underline"
              >
                {office.name}
              </Link>
              {!office.active && <Badge variant="secondary">Inactiva</Badge>}
            </div>
            <span className="text-muted-foreground text-sm">{office.address}</span>
            <span className="text-muted-foreground text-sm">{office.timeZone}</span>
          </div>
          <AdminControls
            isAdmin={isAdmin}
            active={office.active}
            onEdit={() =>
              void navigate({ to: "/sedes/$officeId/editar", params: { officeId: office.id } })
            }
            deactivation={{
              question: `¿Desactivar ${office.name}?`,
              countUpcoming: () => getOfficeUpcomingCount({ data: { id: office.id } }),
            }}
            onToggleActive={() =>
              void toggle.run(() =>
                changeOfficeActive({ data: { id: office.id, active: !office.active } }),
              )
            }
          />
          <ErrorAlert message={toggle.error} />
        </CardContent>
      </Card>
    </li>
  );
}
