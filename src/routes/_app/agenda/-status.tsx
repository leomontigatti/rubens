import {
  BanIcon,
  CheckCheckIcon,
  CircleCheckIcon,
  CircleIcon,
  DoorOpenIcon,
  UserXIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { appointmentStatusLabels } from "#/lib/appointment-statuses.ts";
import type { AppointmentStatus } from "#/lib/appointments.ts";

// How an appointment's status reads on the calendar
// (docs/domain/appointments.md § Calendar): an icon, and a style of the block.

const statusIcons: Record<AppointmentStatus, LucideIcon> = {
  booked: CircleIcon,
  confirmed: CircleCheckIcon,
  checkedIn: DoorOpenIcon,
  attended: CheckCheckIcon,
  noShow: UserXIcon,
  cancelled: BanIcon,
};

/** Booked outlined, confirmed solid, checked in highlighted, attended dimmed, no-show striped. */
export const statusBlockClasses: Record<AppointmentStatus, string> = {
  booked: "bg-background",
  confirmed: "bg-secondary",
  checkedIn: "bg-background ring-primary ring-2",
  attended: "bg-background opacity-60",
  noShow: "bg-background bg-stripes",
  cancelled: "bg-background line-through opacity-50",
};

export function StatusIcon({ status }: { status: AppointmentStatus }) {
  const Icon = statusIcons[status];
  return <Icon aria-label={appointmentStatusLabels[status]} />;
}
