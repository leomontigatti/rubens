import { Link, Outlet, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { ChevronDownIcon } from "lucide-react";

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
import { getViewer } from "#/server/account.functions.ts";

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
  component: AppShell,
});

function AppShell() {
  const { viewer } = Route.useRouteContext();
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    await router.navigate({ to: "/ingresar" });
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <nav className="flex items-center gap-6">
          <Link to="/" className="font-semibold">
            {viewer.organizationName}
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
