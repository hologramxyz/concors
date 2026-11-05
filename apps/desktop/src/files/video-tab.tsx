import { useContext, useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { FILE_RANGE_DOWNLOAD_CAPABILITY } from "@concors/protocol";
import { CompactLayoutContext } from "@/components/compact-layout";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { Button } from "@/components/ui/button";
import { canSaveFiles, saveFile } from "@/tauri";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import type { OpenFile } from "./context";
import { downloadProjectFile, FileTooLargeError } from "./download";
import { formatSize } from "./file-size";
import { videoMime } from "./preview-kind";
import { useFileRequest } from "./use-file-request";

/** The most a video tab holds in memory; a phone's webview is killed long before a computer's. */
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
const MAX_COMPACT_VIDEO_BYTES = 128 * 1024 * 1024;

type Loaded =
  | { attempt: number; status: "ready"; url: string; size: number }
  | { attempt: number; status: "too-large"; size: number }
  | { attempt: number; status: "failed"; message: string };

/**
 * A read-only tab that plays a video. The machine may be far away and only sends files in pieces
 * over its connection, so the whole file comes first, with progress, and plays from memory. That
 * bounds what can be shown, but needs nothing the app's connection does not already carry.
 * Which formats play is up to each platform's webview, so failure is an ordinary outcome here.
 */
export function VideoFileTab({ file }: { file: OpenFile }) {
  const connection = useContext(TerminalConnectionContext);
  const compact = useContext(CompactLayoutContext);
  const { available, capabilities } = useFileRequest(file);
  const supported = capabilities.includes(FILE_RANGE_DOWNLOAD_CAPABILITY);
  const ready = available && supported && !!connection;
  const { target } = file.document;
  const { directory } = file;
  const [attempt, setAttempt] = useState(0);
  const [progress, setProgress] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [unplayable, setUnplayable] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const maxBytes = compact ? MAX_COMPACT_VIDEO_BYTES : MAX_VIDEO_BYTES;
  const name = file.path.split("/").pop() ?? file.path;

  useEffect(() => {
    if (!ready || !connection) return;
    const abort = new AbortController();
    let url: string | null = null;
    downloadProjectFile(connection, { ...target, directory }, setProgress, {
      signal: abort.signal,
      maxBytes,
    }).then(
      (bytes) => {
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(
          new Blob([bytes as Uint8Array<ArrayBuffer>], { type: videoMime(target.path) ?? "" }),
        );
        setUnplayable(false);
        setLoaded({ attempt, status: "ready", url, size: bytes.length });
      },
      (cause: unknown) => {
        if (abort.signal.aborted) return;
        setLoaded(
          cause instanceof FileTooLargeError
            ? { attempt, status: "too-large", size: cause.size }
            : {
                attempt,
                status: "failed",
                message: cause instanceof Error ? cause.message : "Could not open this file.",
              },
        );
      },
    );
    return () => {
      // Closing a tab halfway stops the transfer; what was asked for is not read for nothing.
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [ready, connection, target, directory, attempt, maxBytes]);

  const current = loaded?.attempt === attempt ? loaded : null;
  const busy = ready && !current;
  const save =
    connection && canSaveFiles
      ? async () => {
          setSaving(0);
          setSaveError(null);
          try {
            await saveFile({
              name,
              mime: videoMime(target.path) ?? "application/octet-stream",
              data: await downloadProjectFile(connection, { ...target, directory }, setSaving),
            });
          } catch (cause) {
            setSaveError(cause instanceof Error ? cause.message : "Could not download this file.");
          } finally {
            setSaving(null);
          }
        }
      : null;
  const error = current?.status === "failed" ? current.message : saveError;
  return (
    <section
      aria-label={`File ${file.path}`}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-t"
    >
      <div
        data-file-toolbar
        className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-2"
      >
        <span
          data-file-path
          title={`${file.directory}/${file.path}`}
          className="min-w-20 flex-1 truncate font-mono text-ui text-muted-foreground"
        >
          {file.path}
        </span>
        {save && (
          <SidebarTooltip place="title-bar" content="Download" disabled={!ready || saving !== null}>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={
                saving === null ? "Download video" : `Downloading ${Math.round(saving * 100)}%`
              }
              disabled={!ready || saving !== null}
              onClick={() => void save()}
            >
              <Download />
            </Button>
          </SidebarTooltip>
        )}
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Reload file from disk"
          disabled={!ready || busy}
          onClick={() => {
            setProgress(0);
            setAttempt((value) => value + 1);
          }}
        >
          <RefreshCw />
        </Button>
      </div>
      {!available && (
        <p role="status" className="border-b px-3 py-2 text-ui text-muted-foreground">
          Disconnected. Reconnect to this machine to open this file.
        </p>
      )}
      {error && (
        <p role="alert" className="border-b px-3 py-2 text-ui text-destructive">
          {error}
        </p>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-muted/50">
        {available && !supported ? (
          <Message>
            This machine’s Concors service is too old to preview videos. Update it from Machines,
            then reopen this file.
          </Message>
        ) : current?.status === "ready" && !unplayable ? (
          <video
            key={current.url}
            src={current.url}
            controls
            playsInline
            preload="metadata"
            aria-label={`Video ${name}`}
            onError={() => setUnplayable(true)}
            className="m-auto block max-h-full max-w-full"
          />
        ) : current?.status === "ready" ? (
          <Message>
            This video can’t play here: this device may not support its format, or the file may be
            damaged.
            {save ? " Download it to open it in another app." : ""}
          </Message>
        ) : current?.status === "too-large" ? (
          <Message>
            This video is {formatSize(current.size)}, too large to preview here (the limit is{" "}
            {formatSize(maxBytes)}).{save ? " Download it to open it in another app." : ""}
          </Message>
        ) : current?.status === "failed" ? (
          <Message>Choose another file or retry with Reload.</Message>
        ) : (
          <Message>
            {busy ? `Reading video… ${Math.round(progress * 100)}%` : "Waiting for the machine…"}
          </Message>
        )}
      </div>
      <div className="shrink-0 border-t px-3 py-1 font-mono text-xs text-muted-foreground">
        Read-only preview{current && "size" in current ? `, ${formatSize(current.size)}` : ""}
      </div>
    </section>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="p-4 text-sm text-muted-foreground">
      {children}
    </p>
  );
}
