import type { LinkProps } from "@tanstack/react-router";
import {
  BellIcon,
  BuildingIcon,
  CalendarDaysIcon,
  CalendarSearchIcon,
  CalendarSyncIcon,
  CalendarXIcon,
  ClockIcon,
  MessageCircleIcon,
  MessagesSquareIcon,
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

const notificationsPath = "/notificaciones";

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
      { label: "Notificaciones", to: notificationsPath, icon: BellIcon },
      { label: "A reprogramar", to: toReschedulePath, icon: CalendarSyncIcon },
      { label: "Pacientes", to: "/pacientes", icon: UsersIcon },
      { label: "Conversaciones", to: "/conversaciones", icon: MessagesSquareIcon },
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
      { label: "WhatsApp", to: "/whatsapp", icon: MessageCircleIcon, adminOnly: true },
    ],
  },
];

/** What the links count: the appointments to reschedule, `null` when the member may not see the list, and their unread notifications. */
export interface NavCounts {
  toReschedule: number | null;
  unreadNotifications: number;
}

function countOf(to: string, counts: NavCounts) {
  if (to === toReschedulePath) {
    return counts.toReschedule ?? 0;
  }
  return to === notificationsPath ? counts.unreadNotifications : 0;
}

/** The links `roles` see, each with its count. */
export function navFor(roles: readonly Role[], counts: NavCounts) {
  const isAdmin = roles.includes("admin");
  return groups.map((group) => ({
    label: group.label,
    items: group.items
      .filter((item) => isAdmin || !item.adminOnly)
      .filter((item) => item.to !== toReschedulePath || counts.toReschedule !== null)
      .map((item) => ({ ...item, count: countOf(item.to, counts) })),
  }));
}

/** Whether `pathname` is the link's page or one under it. */
export function isCurrentPath(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}
