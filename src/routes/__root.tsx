import type { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
  useLoaderData,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { SignInProvider } from "#/components/sign-in-provider.tsx";
import { Toaster } from "#/components/ui/toast.tsx";
import { getSignInConfig } from "#/server/sign-in.functions.ts";

import appCss from "../styles.css?url";

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "underthing" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  // Which sign-in the Worker serves does not change while a page is open.
  loader: () => getSignInConfig(),
  shouldReload: false,
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR">
      <head>
        <HeadContent />
      </head>
      <body>
        <SignInProvider config={useLoaderData({ from: "__root__" })}>
          <Toaster>{children}</Toaster>
        </SignInProvider>
        <Scripts />
      </body>
    </html>
  );
}
