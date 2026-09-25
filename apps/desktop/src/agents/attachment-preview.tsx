import { useContext, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { File, ImageOff } from "lucide-react";
import type { AgentAttachment, AgentItem } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { cachedAttachment, isPreviewableImage, loadAttachment } from "./attachment-cache";

/** A message's attachments: images as square thumbnails side by side, other files after them. */
export function MessageAttachments({
  item,
  className = "",
}: {
  item: AgentItem;
  className?: string;
}) {
  const attachments = (item.attachments ?? []).map((attachment, index) => ({ attachment, index }));
  if (!attachments.length) return null;
  const images = attachments.filter(({ attachment }) => isPreviewableImage(attachment.mime));
  const files = attachments.filter(({ attachment }) => !isPreviewableImage(attachment.mime));
  return (
    <div data-message-attachments className={`space-y-2 ${className}`}>
      {!!images.length && (
        <div className="flex flex-wrap gap-2">
          {images.map(({ attachment, index }) => (
            <ImageThumbnail key={index} item={item} attachment={attachment} index={index} />
          ))}
        </div>
      )}
      {!!files.length && (
        <div className="flex flex-wrap gap-2">
          {files.map(({ attachment, index }) => (
            <AttachmentPreview key={index} item={item} attachment={attachment} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Shows the image itself, loaded as soon as the message is on screen; the one this client just
 * sent is already in memory. Clicking opens it at full size.
 */
function ImageThumbnail({
  item,
  attachment,
  index,
}: {
  item: AgentItem;
  attachment: { name: string; mime: string };
  index: number;
}) {
  const connection = useContext(TerminalConnectionContext);
  const [value, setValue] = useState<AgentAttachment | null>(() =>
    cachedAttachment(item.sessionId, item.id, index),
  );
  const [failure, setFailure] = useState<string | null>(null);
  const error = failure ?? (!value && !connection ? "Reconnect to preview this image." : null);
  useEffect(() => {
    if (value || !connection) return;
    let current = true;
    loadAttachment(connection, item.sessionId, item.id, index)
      .then((loaded) => {
        if (current) setValue(loaded);
      })
      .catch((cause: unknown) => {
        if (current) setFailure(cause instanceof Error ? cause.message : "Could not load image");
      });
    return () => {
      current = false;
    };
  }, [connection, item.sessionId, item.id, index, value]);
  const source = value && `data:${value.mime};base64,${value.data}`;
  const tile =
    "relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/60";
  if (!source)
    return (
      <div
        data-image-attachment={error ? "failed" : "loading"}
        role="img"
        aria-label={error ? `${attachment.name}: ${error}` : `Loading ${attachment.name}`}
        title={error ?? attachment.name}
        className={`${tile} ${error ? "text-muted-foreground" : "animate-pulse"}`}
      >
        {error && <ImageOff className="size-5" aria-hidden="true" />}
      </div>
    );
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          data-image-attachment="ready"
          aria-label={`Open ${attachment.name}`}
          title={attachment.name}
          className={`${tile} cursor-zoom-in hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`}
        >
          <img className="size-full object-cover" src={source} alt={attachment.name} />
        </button>
      </DialogTrigger>
      <DialogContent size="wide" closeLabel="Close image" className="overflow-hidden">
        <DialogHeader>
          <DialogTitle>{attachment.name}</DialogTitle>
          <DialogDescription className="sr-only">Image sent with this message.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <img className="mx-auto max-w-full" src={source} alt={attachment.name} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

export function AttachmentPreview({
  item,
  attachment,
  index,
}: {
  item: AgentItem;
  attachment: { name: string; mime: string };
  index: number;
}) {
  const connection = useContext(TerminalConnectionContext);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<AgentAttachment | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const show = async () => {
    setError(null);
    if (value) return;
    try {
      if (!connection) throw new Error("Reconnect to preview this attachment.");
      const attachment = await loadAttachment(connection, item.sessionId, item.id, index);
      let previewText: string | null = null;
      if (
        attachment.mime.startsWith("text/") ||
        ["application/json", "application/xml"].includes(attachment.mime)
      ) {
        try {
          previewText = new TextDecoder().decode(
            Uint8Array.from(atob(attachment.data), (c) => c.charCodeAt(0)),
          );
        } catch {
          throw new Error("This attachment is damaged and could not be previewed.");
        }
      }
      setText(previewText);
      setValue(attachment);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not load attachment");
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          onClick={() => void show()}
          className="flex max-w-full items-center gap-2 rounded-md border px-2.5 py-2 text-sm hover:bg-muted"
        >
          <File className="size-4 shrink-0" />
          <span className="truncate">{attachment.name}</span>
        </button>
      </DialogTrigger>
      <DialogContent size="wide" closeLabel="Close attachment" className="overflow-hidden">
        <DialogHeader>
          <DialogTitle>{attachment.name}</DialogTitle>
          <DialogDescription className="sr-only">
            Attachment sent with this message.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {error ? (
            <p role="alert">{error}</p>
          ) : !value ? (
            <p role="status">Loading attachment…</p>
          ) : text !== null ? (
            <pre className="text-sm break-words whitespace-pre-wrap">{text}</pre>
          ) : (
            <p className="text-sm">
              This file is attached to the conversation. Its format cannot be previewed here.
            </p>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
