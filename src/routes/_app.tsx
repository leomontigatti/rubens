import { Link, Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { authClient } from "#/lib/auth-client.ts";
import { isSignedInAs, reloadOnSessionChange, startNewSession } from "#/lib/session-change.ts";
import { getViewer } from "#/server/account.functions.ts";
import { getToRescheduleCount } from "#/server/appointments.functions.ts";

const passwordChangePath = "/cambiar-contrasena";

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
    return { toReschedule: counted.ok ? counted.count : null };
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
      window.location.reload();
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
        window.location.reload();
      }
    }
    void check();
    return () => {
      stopped = true;
      clearTimeout(retry);
    };
  }, []);
}

/**
 * The menu's link to the "to reschedule" list, with how many it holds in red
 * when any; no link when refused.
 */
function ToRescheduleLink({ count }: { count: number | null }) {
  if (count === null) {
    return null;
  }
  return (
    <Link
      to="/a-reprogramar"
      className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm"
      activeProps={{ className: "text-foreground" }}
    >
      A reprogramar
      {count > 0 && <Badge variant="destructive">{count}</Badge>}
    </Link>
  );
}

function AppShell() {
  const { viewer } = Route.useRouteContext();
  const { toReschedule } = Route.useLoaderData();

  useSessionGuard(viewer.userId);

  async function signOut() {
    await authClient.signOut();
    startNewSession("/ingresar");
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <nav className="flex items-center gap-6">
          <Link to="/" className="font-semibold">
            {viewer.organizationName}
          </Link>
          <Link
            to="/agenda"
            className="text-muted-foreground hover:text-foreground text-sm"
            activeProps={{ className: "text-foreground" }}
          >
            Agenda
          </Link>
          <ToRescheduleLink count={toReschedule} />
          <Link
            to="/pacientes"
            className="text-muted-foreground hover:text-foreground text-sm"
            activeProps={{ className: "text-foreground" }}
          >
            Pacientes
          </Link>
          <Link
            to="/sedes"
            className="text-muted-foreground hover:text-foreground text-sm"
            activeProps={{ className: "text-foreground" }}
          >
            Sedes
          </Link>
          <Link
            to="/horarios"
            className="text-muted-foreground hover:text-foreground text-sm"
            activeProps={{ className: "text-foreground" }}
          >
            Horarios
          </Link>
          <Link
            to="/prestaciones"
            className="text-muted-foreground hover:text-foreground text-sm"
            activeProps={{ className: "text-foreground" }}
          >
            Prestaciones
          </Link>
          <Link
            to="/disponibilidad"
            className="text-muted-foreground hover:text-foreground text-sm"
            activeProps={{ className: "text-foreground" }}
          >
            Disponibilidad
          </Link>
          <Link
            to="/licencias"
            className="text-muted-foreground hover:text-foreground text-sm"
            activeProps={{ className: "text-foreground" }}
          >
            Licencias
          </Link>
          <Link
            to="/cierres"
            className="text-muted-foreground hover:text-foreground text-sm"
            activeProps={{ className: "text-foreground" }}
          >
            Cierres
          </Link>
          {viewer.roles.includes("admin") && (
            <Link
              to="/obras-sociales"
              className="text-muted-foreground hover:text-foreground text-sm"
              activeProps={{ className: "text-foreground" }}
            >
              Obras sociales
            </Link>
          )}
          {viewer.roles.includes("admin") && (
            <Link
              to="/personal"
              className="text-muted-foreground hover:text-foreground text-sm"
              activeProps={{ className: "text-foreground" }}
            >
              Personal
            </Link>
          )}
        </nav>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" />}>
            {viewer.name}
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{viewer.email}</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link to={passwordChangePath} />}>
              Cambiar contraseña
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void signOut()}>Cerrar sesión</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
