import { useEffect, useState, type ReactElement } from "react";
import { ContextMenu } from "radix-ui";
import { Copy, Download, ExternalLink, Link } from "lucide-react";
import { copyText } from "@/lib/clipboard";

/**
 * The right-click menu for links in chat. The webview's own link menu offers Open Link in New
 * Window and Download Linked File, which cannot work here: the app has no browser windows, the
 * webview cancels downloads, and a file link names a path on the agent's machine rather than an
 * address the webview could fetch. Selected text keeps a Copy item, which the native menu gave.
 */
export function LinkMenu({
  children,
  open,
  openLabel,
  copy,
  copyLabel,
  download,
}: {
  children: ReactElement;
  open: () => void;
  openLabel: string;
  copy: string;
  copyLabel: string;
  /** Saves the linked file to the device; absent where there is nothing to save or nowhere to. */
  download?: ((onProgress: (fraction: number) => void) => Promise<void>) | undefined;
}) {
  const [selection, setSelection] = useState("");
  const [status, setStatus] = useState<
    | { kind: "saving"; progress: number }
    | { kind: "saved" }
    | { kind: "error"; message: string }
    | null
  >(null);
  useEffect(() => {
    if (!status || status.kind === "saving") return;
    const timer = setTimeout(() => setStatus(null), status.kind === "saved" ? 3000 : 8000);
    return () => clearTimeout(timer);
  }, [status]);
  const item =
    "flex items-center gap-2 rounded px-2 py-1.5 outline-none focus:bg-accent data-disabled:opacity-40 [&>svg]:size-4";
  return (
    <>
      <ContextMenu.Root
        onOpenChange={(next) => {
          if (next) setSelection(window.getSelection()?.toString().trim() ?? "");
        }}
      >
        <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className="z-50 min-w-44 rounded-lg border bg-popover p-1 text-ui text-popover-foreground shadow-md">
            {selection && (
              <ContextMenu.Item className={item} onSelect={() => void copyText(selection)}>
                <Copy />
                Copy
              </ContextMenu.Item>
            )}
            <ContextMenu.Item className={item} onSelect={open}>
              <ExternalLink />
              {openLabel}
            </ContextMenu.Item>
            {download && (
              <ContextMenu.Item
                className={item}
                disabled={status?.kind === "saving"}
                onSelect={() => {
                  setStatus({ kind: "saving", progress: 0 });
                  void download((progress) => setStatus({ kind: "saving", progress })).then(
                    () => setStatus({ kind: "saved" }),
                    (cause: unknown) =>
                      setStatus({
                        kind: "error",
                        message:
                          cause instanceof Error ? cause.message : "Could not download this file.",
                      }),
                  );
                }}
              >
                <Download />
                Download
              </ContextMenu.Item>
            )}
            <ContextMenu.Item className={item} onSelect={() => void copyText(copy)}>
              <Link />
              {copyLabel}
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {status && (
        <span
          role={status.kind === "error" ? "alert" : "status"}
          className={`ml-1.5 text-xs ${status.kind === "error" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {status.kind === "saving"
            ? // A file small enough to arrive in one piece shows no percentage.
              status.progress > 0 && status.progress < 1
              ? `Downloading… ${Math.floor(status.progress * 100)}%`
              : "Downloading…"
            : status.kind === "saved"
              ? "Saved to Downloads"
              : status.message}
        </span>
      )}
    </>
  );
}
