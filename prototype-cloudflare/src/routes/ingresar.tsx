import { createFileRoute } from "@tanstack/react-router";

// Plain HTML: the form posts to /api/sign-in, which sets the session cookie and redirects.
export const Route = createFileRoute("/ingresar")({
  validateSearch: (search: Record<string, unknown>) => ({
    error: search.error === "1" ? true : undefined,
  }),
  component: SignIn,
});

function SignIn() {
  const { error } = Route.useSearch();
  return (
    <main>
      <h1>Ingresar</h1>
      {error && <p role="alert">Email o contraseña incorrectos.</p>}
      <form method="post" action="/api/sign-in">
        <label>
          Email <input name="email" type="email" required defaultValue="admin@rubens.example" />
        </label>
        <label>
          Contraseña{" "}
          <input name="password" type="password" required defaultValue="rubens-dev-password" />
        </label>
        <button type="submit">Ingresar</button>
      </form>
    </main>
  );
}
