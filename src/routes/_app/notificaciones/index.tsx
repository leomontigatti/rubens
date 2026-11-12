import { BellIcon } from "lucide-react";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { cn } from "cn";
import { useState } from "react";

import { RefusalMessage } from "#/components/admin-form.tsx";
import { EmptyState } from "#/components/empty-state.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { serverAnswer, shownPath } from "#/components/save-failure.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { toast } from "#/components/ui/toast.tsx";
import { getNotifications, markNotificationRead } from "#/server/notifications.functions.ts";

import {
  localTime,
  notificationText,
  notificationTitle,
  waitingText,
} from "#/routes/_app/notificaciones/-notification-copy.ts";

// The member's notifications (ui: "Notificaciones"), unread first, each read
// or unread on its own: Meta's limits on the number and the templates, which
// go to every admin (docs/domain/messages.md § When Meta limits the number)
// and link to the WhatsApp settings, where they are fixed; and handoffs, which
// go to their recipients and link to the conversation, as do their reminders; and replies that look
// like opt-outs, which go to reception and the admins and link to the
// patient's message, marked out, where whoever reads it decides on their
// WhatsApp consent, so they carry no buttons of their own and show as
// resolved once someone decided; and cancellations a
// patient made through the assistant, which go to reception and the admins
// and link to the appointment's week on the agenda, cancelled ones shown,
// where its free time is given to another patient.

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

/** Marks one notification read, the one in progress shown on its row; a refusal is a toast, since no form holds it. */
function useMarkRead() {
  const router = useRouter();
  const [marking, setMarking] = useState<string | null>(null);

  async function markRead(notificationId: string) {
    setMarking(notificationId);
    try {
      const result = await serverAnswer("mark-notification-read", shownPath(router), () =>
        markNotificationRead({ data: { notificationId } }),
      );
      if (result?.ok) {
        await router.invalidate();
      } else if (result) {
        toast.add({ title: refusalMessages[result.reason], type: "destructive" });
      }
    } finally {
      setMarking(null);
    }
  }

  return { marking, markRead };
}

function NotificationList() {
  const result = Route.useLoaderData();
  const { marking, markRead } = useMarkRead();

  if (!result.ok) {
    return <RefusalMessage message={refusalMessages[result.reason]} />;
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notificaciones"
        description="Los avisos para vos, como las conversaciones que te derivaron, los turnos que los pacientes cancelaron por WhatsApp, los pacientes que pidieron no recibir más mensajes y los de Meta sobre el número de WhatsApp."
      />
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
              marking={marking === notification.id}
              onRead={() => void markRead(notification.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationRow(props: {
  notification: Notification;
  marking: boolean;
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
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cn(notification.read ? "font-normal" : "font-medium")}>
            {notificationTitle(notification)}
          </p>
          {!notification.read && <Badge variant="info">Sin leer</Badge>}
          {notification.resolved && <Badge variant="secondary">Resuelta</Badge>}
        </div>
        <p className="text-muted-foreground">{notificationText(notification)}</p>
        {waiting && <p className="text-muted-foreground">{waiting}</p>}
        <p className="text-muted-foreground text-xs">{localTime(notification.createdAt)}</p>
      </div>
      <div className="flex gap-2">
        <NotificationLink notification={notification} />
        {!notification.read && (
          <Button variant="outline" size="sm" disabled={props.marking} onClick={props.onRead}>
            {props.marking && <Spinner data-icon="inline-start" aria-hidden />}
            Marcar como leída
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * Where a notification is acted on: the conversation handed off or not
 * delivered to, with the handoff contacts when no practitioner could take
 * it, the cancelled appointment's week, the opt-out's message, or for one
 * kept from before, the patient to turn off, the template, or the WhatsApp
 * settings.
 */
function NotificationLink({ notification }: { notification: Notification }) {
  if (notification.messageId && notification.conversationId) {
    return (
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={
          <Link
            to="/conversaciones/$conversationId"
            params={{ conversationId: notification.conversationId }}
            search={{ mensaje: notification.messageId }}
          />
        }
      >
        Ver mensaje
      </Button>
    );
  }
  if (notification.appointment) {
    const { roomId, date } = notification.appointment;
    return (
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={
          <Link to="/agenda" search={{ consultorio: roomId, fecha: date, cancelados: true }} />
        }
      >
        Ver en la agenda
      </Button>
    );
  }
  if (notification.conversationId) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={
            <Link
              to="/conversaciones/$conversationId"
              params={{ conversationId: notification.conversationId }}
            />
          }
        >
          Ver conversación
        </Button>
        {notification.handoff?.noPractitioner && (
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link to="/whatsapp/configuracion/contactos" />}
          >
            Ver contactos de derivación
          </Button>
        )}
      </>
    );
  }
  if (notification.patient) {
    return (
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<Link to="/pacientes/$patientId" params={{ patientId: notification.patient.id }} />}
      >
        Ver paciente
      </Button>
    );
  }
  if (notification.templateId) {
    return (
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={
          <Link
            to="/whatsapp/plantillas/$templateId"
            params={{ templateId: notification.templateId }}
          />
        }
      >
        Ver plantilla
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      nativeButton={false}
      render={<Link to="/whatsapp/configuracion" />}
    >
      Ver WhatsApp
    </Button>
  );
}
