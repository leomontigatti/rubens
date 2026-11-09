import { BellIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { cn } from "cn";

import { ErrorAlert, RefusalMessage, useFormAction } from "#/components/admin-form.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { getNotifications, markNotificationRead } from "#/server/notifications.functions.ts";

import {
  localTime,
  notificationText,
  notificationTitle,
  waitingText,
} from "#/routes/_app/notificaciones/-notification-copy.ts";

// The member's notifications (ui: "Notificaciones"), newest first, each read
// or unread on its own. The first are Meta's limits on the number and the
// templates, which go to every admin (docs/domain/messages.md § When Meta
// limits the number); each links to the WhatsApp settings, where they are fixed.

export const Route = createFileRoute("/_app/notificaciones/")({
  head: () => ({ meta: [{ title: "Notificaciones · underthing" }] }),
  loader: () => getNotifications(),
  component: NotificationList,
});

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "No podés ver las notificaciones.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "No se encontró la notificación.",
  notFound: "No se encontró la notificación. Recargá la página.",
};

type Loaded = Extract<Awaited<ReturnType<typeof getNotifications>>, { ok: true }>;
type Notification = Loaded["notifications"][number];

function NotificationList() {
  const result = Route.useLoaderData();
  const action = useFormAction(refusalMessages);

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notificaciones"
        description="Los avisos para vos, como los de Meta sobre el número de WhatsApp y sus plantillas."
      />
      {action.error && <ErrorAlert message={action.error} />}
      {result.notifications.length === 0 ? (
        <EmptyState
          icon={BellIcon}
          title="Sin notificaciones"
          description="Cuando haya un aviso para vos, aparece acá. No hace falta hacer nada."
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {result.notifications.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              pending={action.pending}
              onRead={() =>
                void action.run(() =>
                  markNotificationRead({ data: { notificationId: notification.id } }),
                )
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationRow(props: {
  notification: Notification;
  pending: boolean;
  onRead: () => void;
}) {
  const { notification } = props;
  const waiting = waitingText(notification.waiting);
  return (
    <li className="flex flex-wrap items-start gap-4 p-4">
      <span
        aria-hidden
        className={cn(
          "mt-1.5 size-2 shrink-0 rounded-full",
          notification.read ? "bg-transparent" : "bg-primary",
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cn(notification.read ? "font-normal" : "font-medium")}>
            {notificationTitle(notification)}
          </p>
          {!notification.read && <Badge variant="info">Sin leer</Badge>}
        </div>
        <p className="text-muted-foreground">{notificationText(notification)}</p>
        {waiting && <p className="text-muted-foreground">{waiting}</p>}
        <p className="text-muted-foreground text-xs">{localTime(notification.createdAt)}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/whatsapp" />}>
          Ver WhatsApp
        </Button>
        {!notification.read && (
          <Button variant="outline" size="sm" disabled={props.pending} onClick={props.onRead}>
            Marcar como leída
          </Button>
        )}
      </div>
    </li>
  );
}
