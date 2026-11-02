import { ShieldIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { AdminControls, ErrorAlert, RefusalMessage } from "#/components/admin-form.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { CreateButton } from "#/components/form-page.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { insurerKindLabels } from "#/lib/coverages.ts";
import { changeInsurerActive, getInsurers } from "#/server/insurers.functions.ts";
import type { Insurer } from "#/server/insurers.ts";

import { refusalMessages, useAction } from "#/routes/_app/obras-sociales/-insurer-form.tsx";

export const Route = createFileRoute("/_app/obras-sociales/")({
  head: () => ({ meta: [{ title: "Obras sociales y prepagas · Rubens" }] }),
  validateSearch: z.object({ inactivas: z.boolean().optional() }),
  loaderDeps: ({ search }) => ({ includeInactive: search.inactivas ?? false }),
  loader: ({ deps }) => getInsurers({ data: deps }),
  component: Insurers,
});

function Insurers() {
  const { viewer } = Route.useRouteContext();
  const result = Route.useLoaderData();
  const isAdmin = viewer.roles.includes("admin");

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Obras sociales y prepagas" actions={<ShowInactiveInsurers />} />
      <CreateButton can={isAdmin} link={<Link to="/obras-sociales/nueva" />}>
        Nueva obra social o prepaga
      </CreateButton>
      <InsurerList insurers={result.insurers} isAdmin={isAdmin} />
    </div>
  );
}

function ShowInactiveInsurers() {
  const { inactivas } = Route.useSearch();
  return (
    <Button
      variant="outline"
      nativeButton={false}
      render={<Link to="/obras-sociales" search={{ inactivas: inactivas ? undefined : true }} />}
    >
      {inactivas ? "Ocultar inactivas" : "Mostrar inactivas"}
    </Button>
  );
}

function InsurerList({ insurers, isAdmin }: { insurers: Insurer[]; isAdmin: boolean }) {
  const { inactivas } = Route.useSearch();
  if (insurers.length === 0) {
    return (
      <EmptyState
        icon={ShieldIcon}
        title="No hay obras sociales ni prepagas para mostrar"
        description={`Agregá una con Nueva obra social o prepaga${inactivas ? "" : ", o mirá las inactivas"}.`}
        canAct={isAdmin}
      />
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {insurers.map((insurer) => (
        <InsurerItem key={insurer.id} insurer={insurer} isAdmin={isAdmin} />
      ))}
    </ul>
  );
}

function InsurerItem({ insurer, isAdmin }: { insurer: Insurer; isAdmin: boolean }) {
  const toggle = useAction();

  return (
    <li>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 font-medium">
              {insurer.name}
              {!insurer.active && <Badge variant="secondary">Inactiva</Badge>}
            </span>
            <span className="text-muted-foreground text-sm">{insurerKindLabels[insurer.kind]}</span>
          </div>
          <AdminControls
            isAdmin={isAdmin}
            active={insurer.active}
            editLink={<Link to="/obras-sociales/$insurerId" params={{ insurerId: insurer.id }} />}
            onToggleActive={() =>
              void toggle.run(() =>
                changeInsurerActive({ data: { id: insurer.id, active: !insurer.active } }),
              )
            }
          />
          <ErrorAlert message={toggle.error} />
        </CardContent>
      </Card>
    </li>
  );
}
