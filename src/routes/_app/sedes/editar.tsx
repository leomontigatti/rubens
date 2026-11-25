import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { fixedCrumbs } from "#/components/app-breadcrumbs.tsx";
import { PrototypeSwitcher } from "#/components/prototype-switcher.tsx";

import {
  loadPrototypeOffice,
  prototypeVariants,
  seedPrototype,
  variantSchema,
} from "#/routes/_app/sedes/-prototype-store.ts";
import { OfficeForm } from "#/routes/_app/sedes/-prototype-variants.tsx";
import { RefusalAlert } from "#/routes/_app/sedes/-shared.tsx";

// PROTOTYPE (LEO-6), never merged: the office's form page, which variants B and
// C open from the settings page. Variant A holds the form in its own tab.

export const Route = createFileRoute("/_app/sedes/editar")({
  head: () => ({ meta: [{ title: "Datos de la sede · underthing" }] }),
  validateSearch: z.object({ variant: variantSchema }),
  loader: () => loadPrototypeOffice(),
  staticData: { crumbs: fixedCrumbs("Datos de la sede") },
  component: EditOffice,
});

function EditOffice() {
  const { viewer } = Route.useRouteContext();
  const result = Route.useLoaderData();
  const { variant = "B" } = Route.useSearch();
  const navigate = Route.useNavigate();
  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }
  if (!viewer.roles.includes("admin")) {
    return <RefusalAlert reason="forbidden" />;
  }
  seedPrototype(result);
  return (
    <>
      <OfficeForm
        variant={variant}
        title="Datos de la sede"
        description="El nombre, el domicilio y la zona horaria de la sede."
      />
      <PrototypeSwitcher
        variants={prototypeVariants}
        current={variant}
        onChange={(key) => void navigate({ to: "/sedes", search: { variant: key } })}
      />
    </>
  );
}
