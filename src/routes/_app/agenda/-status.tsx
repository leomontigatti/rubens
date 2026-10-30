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
// (docs/domain/appointments.md § Calendar): an icon only, named for screen readers.

const statusIcons: Record<AppointmentStatus, LucideIcon> = {
  booked: CircleIcon,
  confirmed: CircleCheckIcon,
  checkedIn: DoorOpenIcon,
  attended: CheckCheckIcon,
  noShow: UserXIcon,
  cancelled: BanIcon,
};

export function StatusIcon({ status }: { status: AppointmentStatus }) {
  const Icon = statusIcons[status];
  return <Icon role="img" aria-label={appointmentStatusLabels[status]} />;
}
