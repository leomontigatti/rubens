import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/")({ component: Home });

function Home() {
  const { viewer } = Route.useRouteContext();
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">Hola, {viewer.name}</h1>
      <p className="text-muted-foreground mt-2">Gestión de turnos de {viewer.organizationName}.</p>
    </div>
  );
}
