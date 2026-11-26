import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { PrototypeSwitcher } from "#/components/prototype-switcher.tsx";

import {
  loadPrototypeOffice,
  prototypeVariants,
  seedPrototype,
  variantSchema,
} from "#/routes/_app/consultorios/-prototype-store.ts";
import { VariantA, VariantB, VariantC } from "#/routes/_app/consultorios/-prototype-variants.tsx";
import { RefusalAlert } from "#/routes/_app/sedes/-shared.tsx";

// PROTOTYPE (LEO-6), never merged: three variants of the single office's
// settings page, switchable via `?variant=` on /consultorios and /consultorios/sede. The
// office list this route held stays on main.

export const Route = createFileRoute("/_app/consultorios/")({
  head: () => ({ meta: [{ title: "Sede · underthing" }] }),
  validateSearch: z.object({
    variant: variantSchema,
    archivados: z.boolean().optional().catch(undefined),
    // The office list's filter, which `/dev/patrones` still links to.
    archivadas: z.boolean().optional().catch(undefined),
  }),
  loader: () => loadPrototypeOffice(),
  component: OfficeSettings,
});

function OfficeSettings() {
  const { viewer } = Route.useRouteContext();
  const result = Route.useLoaderData();
  const { variant = "A", archivados } = Route.useSearch();
  const navigate = Route.useNavigate();

  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }
  seedPrototype(result);
  const props = {
    canEdit: viewer.roles.includes("admin"),
    archivados: archivados ?? false,
    onArchivados: (included: boolean | undefined) =>
      void navigate({ search: (prev) => ({ ...prev, archivados: included }), replace: true }),
  };
  return (
    <>
      {variant === "A" && <VariantA {...props} />}
      {variant === "B" && <VariantB {...props} />}
      {variant === "C" && <VariantC {...props} />}
      <PrototypeSwitcher
        variants={prototypeVariants}
        current={variant}
        onChange={(key) =>
          void navigate({ search: (prev) => ({ ...prev, variant: key }), replace: true })
        }
      />
    </>
  );
}
