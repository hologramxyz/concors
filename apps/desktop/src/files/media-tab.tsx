import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, ZoomIn, ZoomOut } from "lucide-react";
import { FILE_PREVIEW_CAPABILITY, type FilePreview } from "@concors/protocol";
import { Button } from "@/components/ui/button";
import type { OpenFile } from "./context";
import type { PreviewKind } from "./preview-kind";
import { useFileRequest } from "./use-file-request";
import { MAX_ZOOM, MIN_ZOOM, stepZoom, useZoomAnchor, useZoomGestures, zoomKey } from "./zoom";
const PdfView = lazy(() => import("./pdf-view"));

/** A read-only tab for PDFs and images, which the text editor cannot open. */
export function MediaFileTab({ file, kind }: { file: OpenFile; kind: PreviewKind }) {
  const { available, request, capabilities } = useFileRequest(file);
  const supported = capabilities.includes(FILE_PREVIEW_CAPABILITY);
  const ready = available && supported;
  const { target } = file.document;
  // Each Reload is a new attempt; a result records the attempt it answers, so the tab is busy
  // until the latest one is in, and an earlier preview stays up while a reload is under way.
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    attempt: number;
    preview: FilePreview | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const settle = (preview: FilePreview | null, error: string | null) => {
      if (!cancelled)
        setResult((current) => ({
          attempt,
          preview: preview ?? current?.preview ?? null,
          error,
        }));
    };
    request({ kind: "preview", ...target }).then(
      (outcome) =>
        outcome.status === "preview"
          ? settle(outcome.preview, null)
          : settle(null, "message" in outcome ? outcome.message : "Could not open this file."),
      (cause: unknown) =>
        settle(null, cause instanceof Error ? cause.message : "Could not open this file."),
    );
    return () => {
      cancelled = true;
    };
  }, [ready, attempt, request, target]);
  const busy = ready && result?.attempt !== attempt;
  // Kept across reloads of the same file, so checking a changed page keeps its magnification.
  const [zoom, setZoom] = useState(1);
  const preview = result?.preview ?? null;
  const error = result?.error ?? null;
  const name = file.path.split("/").pop() ?? file.path;
  const pdf = useMemo(
    () => (preview?.mime === "application/pdf" ? decodeBase64(preview.data) : null),
    [preview],
  );
  let body: React.ReactNode;
  if (available && !supported)
    body = (
      <Message>
        This machine’s Concors service is too old to preview {kind === "pdf" ? "PDFs" : "images"}.
        Update it from Machines, then reopen this file.
      </Message>
    );
  else if (preview && pdf)
    body = (
      <Suspense fallback={<Message>Opening PDF…</Message>}>
        <PdfView key={result?.attempt} data={pdf} name={name} zoom={zoom} onZoom={setZoom} />
      </Suspense>
    );
  else if (preview)
    body = (
      <ImageView
        src={`data:${preview.mime};base64,${preview.data}`}
        name={name}
        zoom={zoom}
        onZoom={setZoom}
      />
    );
  else
    body = (
      <Message>
        {busy
          ? "Reading file…"
          : error
            ? "Choose another file or retry with Reload."
            : "Waiting for the machine…"}
      </Message>
    );
  return (
    <section
      aria-label={`File ${file.path}`}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-t"
      onKeyDown={(event) => {
        const next = preview ? zoomKey(event, zoom) : null;
        if (next === null) return;
        event.preventDefault();
        setZoom(next);
      }}
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
        {preview && (
          <div role="group" aria-label="Zoom" className="flex items-center">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Zoom out"
              title="Zoom out (⌘−)"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => setZoom(stepZoom(zoom, -1))}
            >
              <ZoomOut />
            </Button>
            <Button
              size="xs"
              variant="ghost"
              aria-label={`Zoom ${Math.round(zoom * 100)}%, reset to fit`}
              title="Fit to the tab (⌘0)"
              className="min-h-6 min-w-12 px-1.5 py-0 font-mono text-xs tabular-nums"
              onClick={() => setZoom(1)}
            >
              {Math.round(zoom * 100)}%
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Zoom in"
              title="Zoom in (⌘+)"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => setZoom(stepZoom(zoom, 1))}
            >
              <ZoomIn />
            </Button>
          </div>
        )}
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Reload file from disk"
          disabled={!ready || busy}
          onClick={() => setAttempt((value) => value + 1)}
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
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{body}</div>
      <div className="shrink-0 border-t px-3 py-1 font-mono text-xs text-muted-foreground">
        Read-only preview{preview ? ` · ${formatSize(preview.size)}` : ""}
      </div>
    </section>
  );
}

/**
 * An image at its fit, whole in the tab and never enlarged past its own size, times the zoom.
 * Auto margins centre it while it fits and let a larger one scroll from its top-left corner.
 */
function ImageView({
  src,
  name,
  zoom,
  onZoom,
}: {
  src: string;
  name: string;
  zoom: number;
  onZoom: (zoom: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [room, setRoom] = useState<{ width: number; height: number } | null>(null);
  useZoomGestures(scroller, zoom, onZoom);
  useZoomAnchor(scroller, zoom);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setRoom({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const fit =
    natural && room ? Math.min(1, room.width / natural.width, room.height / natural.height) : null;
  return (
    <div
      ref={scroller}
      tabIndex={0}
      aria-label={`Preview of ${name}`}
      className="flex h-full overflow-auto bg-muted/40 p-4 outline-none"
    >
      <img
        src={src}
        alt={name}
        onLoad={(event) =>
          setNatural({
            width: event.currentTarget.naturalWidth || 1,
            height: event.currentTarget.naturalHeight || 1,
          })
        }
        className="m-auto block max-w-none shrink-0"
        style={
          natural && fit !== null
            ? { width: natural.width * fit * zoom, height: natural.height * fit * zoom }
            : { maxWidth: "100%", maxHeight: "100%" }
        }
      />
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="p-4 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function decodeBase64(data: string) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
