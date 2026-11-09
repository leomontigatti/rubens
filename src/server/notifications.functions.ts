import { createServerFn } from "@tanstack/react-start";

import type { NotificationReference } from "#/lib/notifications.ts";

import { withOrganization } from "#/server/with-organization.ts";

// Notifications (ui: "Notificaciones"): each member reads and marks only their
// own, which the object decides (`src/organization/notifications.ts`), so each
// validator here only names the type.

export const getNotifications = createServerFn({ method: "GET" }).handler(() =>
  withOrganization((organization, caller) => organization.listNotifications(caller)),
);

export const getUnreadNotificationCount = createServerFn({ method: "GET" }).handler(() =>
  withOrganization((organization, caller) => organization.countUnreadNotifications(caller)),
);

export const markNotificationRead = createServerFn({ method: "POST" })
  .validator((data: NotificationReference) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.markNotificationRead(caller, data)),
  );
