import { createFileRoute } from "@tanstack/react-router";

import { authMode } from "../../../lib/identity";
import { devCookie, staff } from "../../../lib/staff";

// Dev mode only (no Clerk key, dev server): sets the dev user cookie. 404 otherwise.
export const Route = createFileRoute("/api/dev/sign-in")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!import.meta.env.DEV || authMode() !== "dev") return new Response(null, { status: 404 });
        const form = await request.formData();
        const person = staff.find((p) => p.devId === String(form.get("userId")));
        if (!person) return new Response(null, { status: 303, headers: { location: "/ingresar" } });
        return new Response(null, {
          status: 303,
          headers: {
            location: "/agenda",
            "set-cookie": `${devCookie}=${person.devId}; Path=/; HttpOnly; SameSite=Lax`,
          },
        });
      },
    },
  },
});
