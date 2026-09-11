import { useContext, useState } from "react";
import { Dialog } from "radix-ui";
import { File, X } from "lucide-react";
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
  const [error, setError] = useState<string | null>(null);
  const show = async () => {
    setOpen(true);
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
      setValue(result.outcome.attachment);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not load attachment");
    }
  };
  const isImage =
    value && ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(value.mime);
  const isText =
    value &&
    (value.mime.startsWith("text/") ||
      ["application/json", "application/xml"].includes(value.mime));
  return (
    <>
      <button
        type="button"
        onClick={() => void show()}
        className="mt-2 flex max-w-full items-center gap-2 rounded-md border px-2.5 py-2 text-sm hover:bg-muted"
      >
        <File className="size-4 shrink-0" />
        <span className="truncate">{attachment.name}</span>
      </button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-background p-4 shadow-xl">
            <div className="flex items-center gap-3">
              <Dialog.Title className="min-w-0 flex-1 truncate font-medium">
                {attachment.name}
              </Dialog.Title>
              <Dialog.Close aria-label="Close attachment" className="p-2">
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              Attachment sent with this message.
            </Dialog.Description>
            <div className="chat-scroll min-h-0 overflow-auto pt-3">
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
              ) : isText ? (
                <pre className="text-sm break-words whitespace-pre-wrap">
                  {new TextDecoder().decode(
                    Uint8Array.from(atob(value.data), (c) => c.charCodeAt(0)),
                  )}
                </pre>
              ) : (
                <p className="text-sm">
                  This file is attached to the conversation. Its format cannot be previewed here.
                </p>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
