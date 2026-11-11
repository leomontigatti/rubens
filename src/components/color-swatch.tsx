import { cn } from "cn";

import { practitionerColorClasses } from "#/lib/practitioner-colors.ts";
import type { PractitionerColor } from "#/lib/practitioner-colors.ts";

/** A practitioner's agenda colour, as a dot. */
export function ColorSwatch({ color }: { color: PractitionerColor }) {
  return (
    <span
      aria-hidden
      className={cn("size-4 shrink-0 rounded-full", practitionerColorClasses[color])}
    />
  );
}
