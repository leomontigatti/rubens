import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-semibold">Rubens</h1>
      <p className="text-muted-foreground mt-2">Gestión de turnos.</p>
    </main>
  );
}
