import { useState } from "react";

import { Button } from "#/components/ui/button.tsx";
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

/** What opens the media of `message`, read at `now`; the line that says it is gone once Meta deleted it. */
export function MessageMediaControl(props: {
  conversationId: string;
  message: InboxMessage & { media: MessageMedia };
  now: number;
}) {
  const { conversationId, message } = props;
  const action = mediaAction(message.media, props.now);
  if (action === null) {
    return <p className="text-muted-foreground text-xs">{unavailableText}</p>;
  }
  const url = mediaUrl(conversationId, message.id);
  switch (message.media.kind) {
    case "audio":
      return <VoiceNotePlayer url={url} action={action} />;
    case "image":
    case "video":
      return <MediaViewer url={url} action={action} message={message} />;
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
function VoiceNotePlayer(props: { url: string; action: string }) {
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <p className="text-muted-foreground text-xs">{failedText}</p>;
  }
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
      onError={() => setFailed(true)}
      className="w-64 max-w-full"
    />
  );
}

/** A photo or a video, in a dialog over the conversation. */
function MediaViewer(props: { url: string; action: string; message: InboxMessage }) {
  const [failed, setFailed] = useState(false);
  const photo = props.message.media?.kind === "image";
  return (
    <Dialog onOpenChange={(open) => open && setFailed(false)}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>{props.action}</DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{photo ? "Foto" : "Video"}</DialogTitle>
          <DialogDescription>
            Enviada por WhatsApp el {messageTime(props.message.sentAt)}
          </DialogDescription>
        </DialogHeader>
        <ViewedMedia
          url={props.url}
          photo={photo}
          failed={failed}
          onError={() => setFailed(true)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ViewedMedia(props: { url: string; photo: boolean; failed: boolean; onError: () => void }) {
  if (props.failed) {
    return <p className="text-muted-foreground">{failedText}</p>;
  }
  if (props.photo) {
    return (
      <img
        src={props.url}
        alt="Foto enviada por WhatsApp"
        onError={props.onError}
        className="max-h-128 w-full rounded-md object-contain"
      />
    );
  }
  return (
    // oxlint-disable-next-line jsx-a11y/media-has-caption -- a patient's video has no captions.
    <video
      controls
      autoPlay
      src={props.url}
      onError={props.onError}
      className="max-h-128 w-full rounded-md"
    />
  );
}
