import { useContext, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { File } from "lucide-react";
import type { AgentAttachment, AgentItem } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";

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
      const result = await connection.requestAgent(
        { kind: "read-attachment", sessionId: item.sessionId, itemId: item.id, index },
        crypto.randomUUID(),
      );
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      if (!result.outcome.attachment)
        throw new Error("Update this machine to preview attachments.");
      const attachment = result.outcome.attachment;
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
  const isImage =
    value && ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(value.mime);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          onClick={() => void show()}
          className="mt-2 flex max-w-full items-center gap-2 rounded-md border px-2.5 py-2 text-sm hover:bg-muted"
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
          ) : isImage ? (
            <img
              className="mx-auto max-w-full"
              src={`data:${value.mime};base64,${value.data}`}
              alt={value.name}
            />
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
