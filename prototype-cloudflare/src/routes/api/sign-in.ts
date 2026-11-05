import { createFileRoute } from "@tanstack/react-router";

import { getAuth } from "../../lib/auth";

export const Route = createFileRoute("/api/sign-in")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData();
        const auth = await getAuth();
        try {
          const { headers } = await auth.api.signInEmail({
            body: { email: String(form.get("email")), password: String(form.get("password")) },
            headers: request.headers,
            returnHeaders: true,
          });
          const out = new Headers({ location: "/agenda" });
          for (const cookie of headers.getSetCookie()) out.append("set-cookie", cookie);
          return new Response(null, { status: 303, headers: out });
        } catch {
          return new Response(null, { status: 303, headers: { location: "/ingresar?error=1" } });
        }
      },
    },
  },
});
