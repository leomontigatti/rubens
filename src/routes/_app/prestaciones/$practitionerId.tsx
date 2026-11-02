import { StethoscopeIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";

import {
  AdminControls,
  ErrorAlert,
  RefusalMessage,
  useFormAction,
} from "#/components/admin-form.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { CreateButton } from "#/components/form-page.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import {
  changeMedicalServiceActive,
  getMedicalServices,
} from "#/server/medical-services.functions.ts";
import type { MedicalService } from "#/server/medical-services.ts";

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

function useAction() {
  return useFormAction(refusalMessages);
}

function PractitionerMedicalServices() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  const { practitioner, medicalServices, canEdit } = result;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
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
      {medicalServices.length === 0 ? (
        <EmptyState
          icon={StethoscopeIcon}
          title="Todavía no tiene prestaciones"
          description="Agregá la primera con Nueva prestación."
          canAct={canEdit}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {medicalServices.map((medicalService) => (
            <MedicalServiceItem
              key={medicalService.id}
              medicalService={medicalService}
              canEdit={canEdit}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function MedicalServiceItem(props: { medicalService: MedicalService; canEdit: boolean }) {
  const { medicalService } = props;
  const { practitionerId } = Route.useParams();
  const toggle = useAction();

  return (
    <li>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-2 font-medium">
                {medicalService.name}
                {!medicalService.active && <Badge variant="secondary">Inactiva</Badge>}
              </span>
              <span className="text-muted-foreground text-sm">
                {medicalService.durationMinutes} min
              </span>
            </div>
          </div>
          <AdminControls
            isAdmin={props.canEdit}
            active={medicalService.active}
            editLink={
              <Link
                to="/prestaciones/$practitionerId/$medicalServiceId"
                params={{ practitionerId, medicalServiceId: medicalService.id }}
              />
            }
            onToggleActive={() =>
              void toggle.run(() =>
                changeMedicalServiceActive({
                  data: { id: medicalService.id, active: !medicalService.active },
                }),
              )
            }
          />
          <ErrorAlert message={toggle.error} />
        </CardContent>
      </Card>
    </li>
  );
}
