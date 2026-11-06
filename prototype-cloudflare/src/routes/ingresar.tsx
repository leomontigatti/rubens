import { SignIn } from "@clerk/tanstack-react-start";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { staff } from "../lib/staff";

const root = getRouteApi("__root__");

export const Route = createFileRoute("/ingresar")({ component: SignInPage });

function SignInPage() {
  const mode = root.useLoaderData();
  if (mode === "clerk") {
    return (
      <main>
        <h1>Ingresar</h1>
        <SignIn routing="hash" forceRedirectUrl="/agenda" />
      </main>
    );
  }
  // Dev mode, no Clerk key: pick one of the seeded staff (plain HTML form, no password).
  return (
    <main>
      <h1>Ingresar (dev, sin Clerk)</h1>
      <form method="post" action="/api/dev/sign-in">
        <label>
          Usuario{" "}
          <select name="userId">
            {staff.map((p) => (
              <option key={p.devId} value={p.devId}>
                {p.name} ({p.roles.join(", ")})
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Ingresar</button>
      </form>
    </main>
  );
}
