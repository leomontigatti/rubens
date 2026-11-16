import { Link } from "@tanstack/react-router";
import { BellIcon } from "lucide-react";

import { notificationsPath } from "#/components/app-nav.ts";
import { Button } from "#/components/ui/button.tsx";

/**
 * The top bar's way to the notifications: a pulsing dot says some are unread,
 * and the label says how many, for whoever cannot see the dot.
 */
export function NotificationsBell({ unread }: { unread: number }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="relative"
      aria-label={unread > 0 ? `Notificaciones (${unread} sin leer)` : "Notificaciones"}
      nativeButton={false}
      render={<Link to={notificationsPath} />}
    >
      <BellIcon />
      {unread > 0 && (
        <span className="absolute top-1.5 right-1.5 flex size-2" aria-hidden>
          <span className="bg-destructive absolute inline-flex size-full motion-safe:animate-ping rounded-full opacity-75" />
          <span className="bg-destructive relative inline-flex size-2 rounded-full" />
        </span>
      )}
    </Button>
  );
}
