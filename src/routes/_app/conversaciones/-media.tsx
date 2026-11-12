import { useState } from "react";

import { Button } from "#/components/ui/button.tsx";
import { toast } from "#/components/ui/toast.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog.tsx";
import type { MessageMedia } from "#/lib/message-media.ts";
import type { InboxMessage } from "#/organization/inbox.ts";

import { mediaAction, messageTime } from "#/routes/_app/conversaciones/-labels.ts";

// A patient's voice note, photo, video or file, opened from Meta on each
// press through the media route (`src/server/message-media.ts`): nothing is
// fetched before the press, and nothing is kept after it.

const unavailableText = "Ya no está disponible en WhatsApp (pasaron más de 7 días)";
const failedText = "WhatsApp no entregó el archivo. Probá de nuevo en un rato.";

function mediaUrl(conversationId: string, messageId: string) {
  return `/api/conversaciones/${conversationId}/mensajes/${messageId}`;
}

/**
 * What opens the media of `message`, read at `now`; the line that says it is
 * gone once Meta deleted it, also when that happened while the page was open.
 * A press Meta did not serve is a toast, and the button stays for a retry.
 */
export function MessageMediaControl(props: {
  conversationId: string;
  message: InboxMessage & { media: MessageMedia };
  now: number;
}) {
  const { conversationId, message } = props;
  const [gone, setGone] = useState(false);
  const action = gone ? null : mediaAction(message.media, props.now);
  if (action === null) {
    return <p className="text-muted-foreground text-xs">{unavailableText}</p>;
  }
  function failed() {
    if (Date.now() >= message.media.availableUntil) {
      setGone(true);
    } else {
      toast.add({ title: failedText, type: "destructive" });
    }
  }
  const url = mediaUrl(conversationId, message.id);
  switch (message.media.kind) {
    case "audio":
      return <VoiceNotePlayer url={url} action={action} onFailed={failed} />;
    case "image":
    case "video":
      return <MediaViewer url={url} action={action} message={message} onFailed={failed} />;
    case "document":
      return (
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<a href={url} target="_blank" rel="noreferrer" />}
        >
          {action}
        </Button>
      );
  }
}

/** `Escuchar`, then the player, which asks the route for the audio only once pressed. */
function VoiceNotePlayer(props: { url: string; action: string; onFailed: () => void }) {
  const [playing, setPlaying] = useState(false);
  if (!playing) {
    return (
      <Button variant="outline" size="sm" onClick={() => setPlaying(true)}>
        {props.action}
      </Button>
    );
  }
  // oxlint-disable-next-line jsx-a11y/media-has-caption -- a patient's voice note has no captions; its transcript is the bubble's text.
  return (
    <audio
      controls
      autoPlay
      src={props.url}
      onError={() => {
        setPlaying(false);
        props.onFailed();
      }}
      className="w-64 max-w-full"
    />
  );
}

/** A photo or a video, in a dialog over the conversation, which closes when Meta does not serve it. */
function MediaViewer(props: {
  url: string;
  action: string;
  message: InboxMessage;
  onFailed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const photo = props.message.media?.kind === "image";
  function failed() {
    setOpen(false);
    props.onFailed();
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>{props.action}</DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{photo ? "Foto" : "Video"}</DialogTitle>
          <DialogDescription>
            Enviada por WhatsApp el {messageTime(props.message.sentAt)}
          </DialogDescription>
        </DialogHeader>
        {photo ? (
          <img
            src={props.url}
            alt="Foto enviada por WhatsApp"
            onError={failed}
            className="max-h-128 w-full rounded-md object-contain"
          />
        ) : (
          // oxlint-disable-next-line jsx-a11y/media-has-caption -- a patient's video has no captions.
          <video
            controls
            autoPlay
            src={props.url}
            onError={failed}
            className="max-h-128 w-full rounded-md"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
