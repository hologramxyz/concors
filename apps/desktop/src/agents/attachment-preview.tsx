import { useContext, useEffect, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Check, Download, File, ImageOff, LoaderCircle } from "lucide-react";
import type { AgentAttachment, AgentItem } from "@concors/protocol";
import { Button } from "@/components/ui/button";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { canSaveFiles, saveFile, type FileToSave } from "@/tauri";
import { cachedAttachment, isPreviewableImage, loadAttachment } from "./attachment-cache";
import { downloadName } from "./download-name";

/** Saving a file from a preview, with its progress for the button and any error for the dialog. */
function useSave(file: FileToSave | null) {
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (state !== "saved") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);
  const save = async () => {
    if (!file || state === "saving") return;
    setState("saving");
    setError(null);
    try {
      await saveFile({ ...file, name: downloadName(file.name, file.mime) });
      setState("saved");
    } catch (cause) {
      setState("idle");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const button =
    canSaveFiles && file ? (
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Download ${file.name}`}
        title={state === "saved" ? "Saved to Downloads" : "Download"}
        disabled={state === "saving"}
        onClick={() => void save()}
      >
        {state === "saving" ? (
          <LoaderCircle className="size-4.5 animate-spin" />
        ) : state === "saved" ? (
          <Check className="size-4.5" />
        ) : (
          <Download className="size-4.5" />
        )}
      </Button>
    ) : null;
  return { button, error };
}

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

/** An attachment's image as a data URL, loaded once the message is on screen. */
function useAttachmentImage(item: AgentItem, index: number) {
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
  return { file: value, source: value && `data:${value.mime};base64,${value.data}`, error };
}

/**
 * Opens an image as large as the window allows when `children`, the trigger, is clicked, with a
 * button to save it unless `downloadable` is off.
 */
export function ImageViewer({
  file,
  name = file.name,
  description,
  downloadable = true,
  children,
}: {
  file: FileToSave;
  /** The title to show, when it differs from the file's own name. */
  name?: string;
  description: string;
  downloadable?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <ImageViewerContent
        file={file}
        name={name}
        description={description}
        downloadable={downloadable}
      />
    </Dialog>
  );
}

function ImageViewerContent({
  file,
  name,
  description,
  downloadable,
}: {
  file: FileToSave;
  name: string;
  description: string;
  downloadable: boolean;
}) {
  const save = useSave(downloadable ? file : null);
  return (
    <DialogContent
      size="media"
      closeLabel="Close image"
      className="overflow-hidden"
      headerActions={save.button}
    >
      <DialogHeader className={save.button ? "pr-20" : undefined}>
        <DialogTitle className="truncate">{name}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col items-center gap-3">
        {/* As large as the image itself, never past the window: tall images scale to fit. */}
        <img
          className="block max-h-[calc(100dvh-9rem)] max-w-full object-contain"
          src={`data:${file.mime};base64,${file.data}`}
          alt={name}
        />
        {save.error && (
          <p role="alert" className="text-sm text-destructive">
            {save.error}
          </p>
        )}
      </DialogBody>
    </DialogContent>
  );
}

/**
 * An image the agent showed, drawn where it put it in the message, at a readable size. Clicking
 * opens it at full size.
 */
export function InlineImage({ item, index, alt }: { item: AgentItem; index: number; alt: string }) {
  const attachment = item.attachments?.[index];
  const { file, source, error } = useAttachmentImage(item, index);
  const name = alt || attachment?.name || "Image";
  if (!file || !source)
    return (
      <span
        data-inline-image={error ? "failed" : "loading"}
        role="img"
        aria-label={error ? `${name}: ${error}` : `Loading ${name}`}
        title={error ?? name}
        className={`my-2 flex h-40 w-full max-w-md items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground ${error ? "" : "animate-pulse"}`}
      >
        {error && <ImageOff className="size-5" aria-hidden="true" />}
      </span>
    );
  return (
    <ImageViewer file={file} name={name} description="Image the agent showed in its reply.">
      <button
        type="button"
        data-inline-image="ready"
        aria-label={`Open ${name}`}
        title={name}
        className="my-2 block max-w-full cursor-pointer overflow-hidden rounded-lg border hover:opacity-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <img className="block max-h-[28rem] max-w-full object-contain" src={source} alt={name} />
      </button>
    </ImageViewer>
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
  const { file, source, error } = useAttachmentImage(item, index);
  const tile =
    "relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/60";
  if (!file || !source)
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
    <ImageViewer file={file} name={attachment.name} description="Image sent with this message.">
      <button
        type="button"
        data-image-attachment="ready"
        aria-label={`Open ${attachment.name}`}
        title={attachment.name}
        className={`${tile} cursor-pointer hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`}
      >
        <img className="size-full object-cover" src={source} alt={attachment.name} />
      </button>
    </ImageViewer>
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
  const save = useSave(value);
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
      <DialogContent
        size="wide"
        closeLabel="Close attachment"
        className="max-w-5xl overflow-hidden"
        headerActions={save.button}
      >
        <DialogHeader className={save.button ? "pr-20" : undefined}>
          <DialogTitle className="truncate">{attachment.name}</DialogTitle>
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
              This file is attached to the conversation. Its format cannot be previewed here
              {canSaveFiles ? "; download it to open it." : "."}
            </p>
          )}
          {save.error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {save.error}
            </p>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
