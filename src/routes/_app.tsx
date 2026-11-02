import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { passwordChangePath } from "#/components/app-nav.ts";
import { AppSidebar } from "#/components/app-sidebar.tsx";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "#/components/ui/sidebar.tsx";
import { TooltipProvider } from "#/components/ui/tooltip.tsx";
import { authClient } from "#/lib/auth-client.ts";
import {
  isSignedInAs,
  reloadForNewSession,
  reloadOnSessionChange,
  startNewSession,
} from "#/lib/session-change.ts";
import { sidebarStartsOpen } from "#/lib/sidebar-state.ts";
import { getViewer } from "#/server/account.functions.ts";
import { getToRescheduleCount } from "#/server/appointments.functions.ts";

// Every signed-in screen sits under this layout. A member who must still
// replace the starting password is held on the change-password screen.
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location }) => {
    const result = await getViewer();
    if (!result.ok) {
      throw redirect({ to: "/ingresar" });
    }
    if (result.viewer.mustChangePassword && location.pathname !== passwordChangePath) {
      throw redirect({ to: passwordChangePath });
    }
    return { viewer: result.viewer };
  },
  // Reloaded on every navigation and after every change a screen makes, so
  // the menu's count of appointments to reschedule stays current.
  loader: async () => {
    const counted = await getToRescheduleCount();
    return { toReschedule: counted.ok ? counted.count : null, sidebarOpen: sidebarStartsOpen() };
  },
  // A signed-in page holds the viewer's data, patients' included: the browser
  // keeps no copy, so Back after a sign-out cannot show it to the next person.
  headers: () => ({ "Cache-Control": "no-store" }),
  component: AppShell,
});

const recheckMs = 5000;

/**
 * Reloads the page once its screen and caches belong to a user other than the
 * one now signed in: when another tab signs in or out, when a link click finds
 * another user signed in, and, for a page that was still loading when another
 * tab's message went out, when a check after mounting says so. A failed check
 * is retried rather than reloaded, so a failing server causes no reload loop.
 */
function useSessionGuard(userId: string) {
  const loadedAs = useRef(userId);

  useEffect(() => reloadOnSessionChange(), []);

  useEffect(() => {
    if (userId !== loadedAs.current) {
      reloadForNewSession();
    }
  }, [userId]);

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    async function check() {
      const result = await getViewer().catch((error: unknown) => {
        console.warn("[session-guard] could not check who is signed in; retrying", error);
        return null;
      });
      if (stopped) {
        return;
      }
      if (result === null) {
        retry = setTimeout(() => void check(), recheckMs);
        return;
      }
      if (!isSignedInAs(result, loadedAs.current)) {
        reloadForNewSession();
      }
    }
    void check();
    return () => {
      stopped = true;
      clearTimeout(retry);
    };
  }, []);
}

function AppShell() {
  const { viewer } = Route.useRouteContext();
  const { toReschedule, sidebarOpen } = Route.useLoaderData();

  useSessionGuard(viewer.userId);

  async function signOut() {
    await authClient.signOut();
    startNewSession("/ingresar");
  }

  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={sidebarOpen}>
        <AppSidebar viewer={viewer} toReschedule={toReschedule} onSignOut={() => void signOut()} />
        <SidebarInset className="min-w-0">
          <header className="flex items-center border-b px-4 py-2">
            <SidebarTrigger />
          </header>
          <div className="flex-1 p-6">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
