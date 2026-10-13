import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { FILE_PREVIEW_CAPABILITY, type FilePreview } from "@concors/protocol";
import { Button } from "@/components/ui/button";
import type { OpenFile } from "./context";
import type { PreviewKind } from "./preview-kind";
import { useFileRequest } from "./use-file-request";
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
        <PdfView key={result?.attempt} data={pdf} name={name} />
      </Suspense>
    );
  else if (preview)
    body = (
      <div className="flex h-full items-center justify-center overflow-auto bg-muted/40 p-4">
        <img
          src={`data:${preview.mime};base64,${preview.data}`}
          alt={name}
          className="max-h-full max-w-full object-contain"
        />
      </div>
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
