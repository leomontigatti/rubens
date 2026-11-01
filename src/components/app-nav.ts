import type { LinkProps } from "@tanstack/react-router";
import {
  BuildingIcon,
  CalendarDaysIcon,
  CalendarSearchIcon,
  CalendarSyncIcon,
  CalendarXIcon,
  ClockIcon,
  ShieldIcon,
  StethoscopeIcon,
  TreePalmIcon,
  UserCogIcon,
  UsersIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { Role } from "#/lib/access.ts";

// What the sidebar shows, apart from how: its groups, and who sees each link.
// It only spares a member a link to a screen that has nothing for them: each
// screen's own server functions decide what they may do there.

export const passwordChangePath = "/cambiar-contrasena";

const toReschedulePath = "/a-reprogramar";

interface NavLink {
  label: string;
  to: NonNullable<LinkProps["to"]>;
  icon: LucideIcon;
  adminOnly?: boolean;
}

const groups: { label: string; items: NavLink[] }[] = [
  {
    label: "Día a día",
    items: [
      { label: "Agenda", to: "/agenda", icon: CalendarDaysIcon },
      { label: "A reprogramar", to: toReschedulePath, icon: CalendarSyncIcon },
      { label: "Pacientes", to: "/pacientes", icon: UsersIcon },
      { label: "Disponibilidad", to: "/disponibilidad", icon: CalendarSearchIcon },
    ],
  },
  {
    label: "Profesionales",
    items: [
      { label: "Horarios", to: "/horarios", icon: ClockIcon },
      { label: "Prestaciones", to: "/prestaciones", icon: StethoscopeIcon },
      { label: "Licencias", to: "/licencias", icon: TreePalmIcon },
    ],
  },
  {
    label: "Administración",
    items: [
      { label: "Sedes", to: "/sedes", icon: BuildingIcon },
      { label: "Cierres", to: "/cierres", icon: CalendarXIcon },
      { label: "Obras sociales", to: "/obras-sociales", icon: ShieldIcon, adminOnly: true },
      { label: "Personal", to: "/personal", icon: UserCogIcon, adminOnly: true },
    ],
  },
];

/**
 * The links `roles` see. `toReschedule` is how many appointments the list
 * holds, `null` when the member may not see it.
 */
export function navFor(roles: readonly Role[], toReschedule: number | null) {
  const isAdmin = roles.includes("admin");
  return groups.map((group) => ({
    label: group.label,
    items: group.items
      .filter((item) => isAdmin || !item.adminOnly)
      .filter((item) => item.to !== toReschedulePath || toReschedule !== null)
      .map((item) => ({
        ...item,
        count: item.to === toReschedulePath ? (toReschedule ?? 0) : 0,
      })),
  }));
}

/** Whether `pathname` is the link's page or one under it. */
export function isCurrentPath(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}
