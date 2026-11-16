import type { LinkProps } from "@tanstack/react-router";
import {
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

export const notificationsPath = "/notificaciones";

type Path = NonNullable<LinkProps["to"]>;

interface NavLink {
  label: string;
  to: Path;
  icon: LucideIcon;
  adminOnly?: boolean;
}

/** A link that only opens its entries, each a page of its own. */
interface NavFolder {
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  entries: { label: string; to: Path }[];
}

const groups: { label: string; items: (NavLink | NavFolder)[] }[] = [
  {
    label: "Día a día",
    items: [
      { label: "Agenda", to: "/agenda", icon: CalendarDaysIcon },
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
      {
        label: "WhatsApp",
        icon: MessageCircleIcon,
        adminOnly: true,
        entries: [
          { label: "Configuración", to: "/whatsapp/configuracion" },
          { label: "Plantillas", to: "/whatsapp/plantillas" },
        ],
      },
    ],
  },
];

/** What the links count: the appointments to reschedule, `null` when the member may not see the list. */
export interface NavCounts {
  toReschedule: number | null;
}

function countOf(item: NavLink | NavFolder, counts: NavCounts) {
  return "to" in item && item.to === toReschedulePath ? (counts.toReschedule ?? 0) : 0;
}

/** The links `roles` see, each with its count. */
export function navFor(roles: readonly Role[], counts: NavCounts) {
  const isAdmin = roles.includes("admin");
  return groups.map((group) => ({
    label: group.label,
    items: group.items
      .filter((item) => isAdmin || !item.adminOnly)
      .filter(
        (item) => !("to" in item) || item.to !== toReschedulePath || counts.toReschedule !== null,
      )
      .map((item) => ({ ...item, count: countOf(item, counts) })),
  }));
}

/** Whether `pathname` is the link's page or one under it. */
export function isCurrentPath(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** Whether `folder` stands open on `pathname`: the page is one of its entries, or under one. */
export function isOpenOn(pathname: string, folder: Pick<NavFolder, "entries">) {
  return folder.entries.some((entry) => isCurrentPath(pathname, entry.to));
}

/** A step of the breadcrumbs: a label, and the page it opens unless it is a folder. */
export interface SectionCrumb {
  label: string;
  to?: Path;
}

/** The pages the top bar opens rather than the menu: the bell and the account menu. */
const outsideTheMenu = [
  { label: "Notificaciones", to: notificationsPath },
  { label: "Cambiar contraseña", to: passwordChangePath },
] satisfies SectionCrumb[];

/** The steps to `pathname` through `item`: its link, or its folder and the folder's entry. */
function stepsTo(pathname: string, item: NavLink | NavFolder): SectionCrumb[] | null {
  if ("to" in item) {
    return isCurrentPath(pathname, item.to) ? [{ label: item.label, to: item.to }] : null;
  }
  const entry = item.entries.find((one) => isCurrentPath(pathname, one.to));
  return entry ? [{ label: item.label }, { label: entry.label, to: entry.to }] : null;
}

/**
 * The section `pathname` sits in, as the sidebar names it: its group, which is
 * no page, then its link, or its folder and the folder's entry. Empty outside
 * every section.
 */
export function sectionOf(pathname: string): SectionCrumb[] {
  const outside = outsideTheMenu.find((page) => isCurrentPath(pathname, page.to));
  if (outside) {
    return [outside];
  }
  for (const group of groups) {
    for (const item of group.items) {
      const steps = stepsTo(pathname, item);
      if (steps) {
        return [{ label: group.label }, ...steps];
      }
    }
  }
  return [];
}
