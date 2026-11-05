import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Rubens on Workers (prototype)" },
    ],
  }),
  shellComponent: RootDocument,
});

const css = `body{font-family:system-ui,sans-serif;margin:1rem}table{border-collapse:collapse;font-size:12px}
td,th{border:1px solid #ccc;padding:4px;vertical-align:top}form{margin:.5rem 0}label{margin-right:.5rem}
.appt{margin:2px 0;padding:2px;border-left:4px solid}.cancelled{text-decoration:line-through;opacity:.6}`;

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR">
      <head>
        <HeadContent />
        <style>{css}</style>
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
