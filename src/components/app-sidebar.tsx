import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronsUpDownIcon, CircleUserIcon } from "lucide-react";

import { isCurrentPath, navFor, passwordChangePath } from "#/components/app-nav.ts";
import type { NavCounts } from "#/components/app-nav.ts";
import { Badge } from "#/components/ui/badge.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "#/components/ui/sidebar.tsx";
import type { Role } from "#/lib/access.ts";

interface Viewer {
  name: string;
  email: string;
  organizationName: string;
  roles: readonly Role[];
}

function NavMenu(props: { roles: readonly Role[]; counts: NavCounts }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { setOpenMobile } = useSidebar();

  return navFor(props.roles, props.counts).map((group) => (
    <SidebarGroup key={group.label}>
      <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {group.items.map((item) => (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton
                isActive={isCurrentPath(pathname, item.to)}
                tooltip={item.count > 0 ? `${item.label} (${item.count})` : item.label}
                render={<Link to={item.to} onClick={() => setOpenMobile(false)} />}
              >
                <item.icon />
                <span>{item.label}</span>
              </SidebarMenuButton>
              {item.count > 0 && (
                <SidebarMenuBadge>
                  <Badge variant="destructive">{item.count}</Badge>
                </SidebarMenuBadge>
              )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  ));
}

function UserMenu(props: { viewer: Viewer; onSignOut: () => void }) {
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton tooltip={props.viewer.name} />}>
            <CircleUserIcon />
            <span>{props.viewer.name}</span>
            <ChevronsUpDownIcon className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? "top" : "right"} align="end" className="w-auto">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{props.viewer.email}</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              render={<Link to={passwordChangePath} onClick={() => setOpenMobile(false)} />}
            >
              Cambiar contraseña
            </DropdownMenuItem>
            <DropdownMenuItem onClick={props.onSignOut}>Cerrar sesión</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** The app's menu: the organization, the links by group and the member's account. */
export function AppSidebar(props: { viewer: Viewer; counts: NavCounts; onSignOut: () => void }) {
  const { viewer } = props;
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={viewer.organizationName}
              render={<Link to="/agenda" onClick={() => setOpenMobile(false)} />}
            >
              <span className="bg-sidebar-primary text-sidebar-primary-foreground flex size-4 shrink-0 items-center justify-center rounded-sm text-xs font-semibold">
                {viewer.organizationName.charAt(0)}
              </span>
              <span className="font-semibold">{viewer.organizationName}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMenu roles={viewer.roles} counts={props.counts} />
      </SidebarContent>
      <SidebarFooter>
        <UserMenu viewer={viewer} onSignOut={props.onSignOut} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
