// PROTOTYPE (LEO-6), never merged: the single office's settings page, in three
// variants switched by `?variant=` on /sedes and /sedes/editar. The office and
// its rooms load once from the dev organization, then live here, in memory:
// nothing a variant does reaches the organization object.

import { BuildingIcon, DoorOpenIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import * as z from "zod";

import { getOfficeWithRooms, getOffices } from "#/server/offices.functions.ts";

export const prototypeVariants = [
  { key: "A", name: "Pestañas" },
  { key: "B", name: "Secciones" },
  { key: "C", name: "Consultorios primero" },
] as const;

export type Variant = (typeof prototypeVariants)[number]["key"];

export const variantSchema = z.enum(["A", "B", "C"]).optional().catch(undefined);

/** What each variant calls the page in the sidebar and the breadcrumbs. */
const navByVariant: Record<Variant, { label: string; icon: LucideIcon }> = {
  A: { label: "Sede", icon: BuildingIcon },
  B: { label: "Sede", icon: BuildingIcon },
  C: { label: "Consultorios", icon: DoorOpenIcon },
};

export interface PrototypeOffice {
  name: string;
  address: string;
  timeZone: string;
}

export interface PrototypeRoom {
  id: string;
  name: string;
  active: boolean;
  /** Made-up appointments ahead, so `Archivar` can ask first. */
  upcoming: number;
}

interface State {
  seeded: boolean;
  variant: Variant;
  office: PrototypeOffice;
  rooms: PrototypeRoom[];
  /** Bumped on each office save, so a form that stays on the page starts again from it. */
  saves: number;
}

let state: State = {
  seeded: false,
  variant: "A",
  office: { name: "", address: "", timeZone: "" },
  rooms: [],
  saves: 0,
};

const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The dev organization's first active office and all its rooms, for the prototype to start from. */
export async function loadPrototypeOffice() {
  const offices = await getOffices({ data: { includeInactive: false } });
  if (!offices.ok) {
    return offices;
  }
  const first = offices.offices[0];
  if (!first) {
    return { ok: false as const, reason: "notFound" as const };
  }
  return getOfficeWithRooms({ data: { officeId: first.id, includeInactive: true } });
}

type Loaded = Extract<Awaited<ReturnType<typeof loadPrototypeOffice>>, { ok: true }>;

/** Starts the store from what the loader read, once per page load. */
export function seedPrototype(loaded: Loaded) {
  if (state.seeded) {
    return;
  }
  state = {
    ...state,
    seeded: true,
    office: {
      name: loaded.office.name,
      address: loaded.office.address,
      timeZone: loaded.office.timeZone,
    },
    rooms: loaded.rooms.map((room, index) => ({
      id: room.id,
      name: room.name,
      active: room.active,
      upcoming: index === 0 ? 4 : 0,
    })),
  };
}

export function usePrototype() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

export const prototypeActions = {
  saveOffice: (office: PrototypeOffice) => set({ office, saves: state.saves + 1 }),
  addRoom: (name: string) =>
    set({ rooms: [...state.rooms, { id: crypto.randomUUID(), name, active: true, upcoming: 0 }] }),
  renameRoom: (id: string, name: string) =>
    set({ rooms: state.rooms.map((room) => (room.id === id ? { ...room, name } : room)) }),
  setRoomActive: (id: string, active: boolean) =>
    set({ rooms: state.rooms.map((room) => (room.id === id ? { ...room, active } : room)) }),
};

function remember(variant: Variant) {
  state.variant = variant;
  return variant;
}

/** The sidebar's and the breadcrumbs' name for the page, by the variant last shown. */
export function usePrototypeNav() {
  const shown = useRouterState({ select: (router) => router.location.search.variant });
  // Remembered quietly while a page shows one, so a link back from elsewhere keeps it.
  const variant = shown ? remember(shown) : state.variant;
  return { ...navByVariant[variant], variant };
}

/** Time zones the prototype offers: Argentina's, then its neighbours'. */
const timeZones: [string, string][] = [
  ["America/Argentina/Buenos_Aires", "Buenos Aires"],
  ["America/Argentina/Cordoba", "Córdoba"],
  ["America/Argentina/Catamarca", "Catamarca"],
  ["America/Argentina/Jujuy", "Jujuy"],
  ["America/Argentina/La_Rioja", "La Rioja"],
  ["America/Argentina/Mendoza", "Mendoza"],
  ["America/Argentina/Rio_Gallegos", "Río Gallegos"],
  ["America/Argentina/Salta", "Salta"],
  ["America/Argentina/San_Juan", "San Juan"],
  ["America/Argentina/San_Luis", "San Luis"],
  ["America/Argentina/Tucuman", "Tucumán"],
  ["America/Argentina/Ushuaia", "Ushuaia"],
  ["America/Montevideo", "Montevideo, Uruguay"],
  ["America/Santiago", "Santiago, Chile"],
  ["America/Asuncion", "Asunción, Paraguay"],
  ["America/Sao_Paulo", "San Pablo, Brasil"],
];

export function timeZoneOptions(current: string) {
  const options = timeZones.map(([value, label]) => ({ value, label }));
  return options.some((option) => option.value === current) || !current
    ? options
    : [{ value: current, label: current }, ...options];
}

export function timeZoneLabel(value: string) {
  return timeZones.find(([zone]) => zone === value)?.[1] ?? value;
}
