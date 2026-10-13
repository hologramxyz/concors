import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Renders a PDF page by page onto canvases, each when it scrolls near view. pdf.js runs on the
 * page's own thread: the mobile bundle is a single inlined script with nowhere to load a worker
 * from, and a preview is light enough not to need one. The legacy build carries the polyfills
 * older system webviews (macOS 13, WebKitGTK) lack.
 */
async function loadPdfJs() {
  // Importing the worker module registers it on globalThis, which pdf.js then uses in place.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

/** Keyed by its caller per file version, so a new document starts from a fresh mount. */
export default function PdfView({ data, name }: { data: Uint8Array; name: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let destroy: (() => Promise<void>) | null = null;
    void loadPdfJs()
      .then(({ getDocument }) => {
        if (cancelled) return null;
        // pdf.js takes ownership of the buffer it is given, so it gets a copy.
        const task = getDocument({ data: data.slice() });
        destroy = () => task.destroy();
        return task.promise;
      })
      .then((document) => {
        if (document && !cancelled) setPdf(document);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(
            cause instanceof Error && cause.name === "PasswordException"
              ? "This PDF is password-protected and can’t be previewed here."
              : "This PDF could not be read. It may be damaged.",
          );
      });
    return () => {
      cancelled = true;
      void destroy?.();
    };
  }, [data]);
  if (error)
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        {error}
      </p>
    );
  if (!pdf)
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Opening PDF…
      </p>
    );
  return (
    <div
      aria-label={`Pages of ${name}`}
      className="flex h-full flex-col items-center gap-4 overflow-auto bg-muted/40 p-4"
    >
      {Array.from({ length: pdf.numPages }, (_, index) => (
        <PdfPage key={index} pdf={pdf} number={index + 1} />
      ))}
    </div>
  );
}

function PdfPage({ pdf, number }: { pdf: PDFDocumentProxy; number: number }) {
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [aspect, setAspect] = useState(Math.SQRT2);
  const [width, setWidth] = useState(0);
  const [near, setNear] = useState(number <= 2);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const resize = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    const intersect = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true);
      },
      { rootMargin: "100% 0px" },
    );
    resize.observe(element);
    intersect.observe(element);
    return () => {
      resize.disconnect();
      intersect.disconnect();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void pdf
      .getPage(number)
      .then((page) => {
        if (cancelled) return;
        const { width: pageWidth, height } = page.getViewport({ scale: 1 });
        setAspect(height / pageWidth);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pdf, number]);
  useEffect(() => {
    const target = canvas.current;
    if (!near || !width || !target) return;
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    let cancelled = false;
    void pdf
      .getPage(number)
      .then((page) => {
        if (cancelled) return;
        const scale = (width / page.getViewport({ scale: 1 }).width) * window.devicePixelRatio;
        const viewport = page.getViewport({ scale });
        target.width = Math.floor(viewport.width);
        target.height = Math.floor(viewport.height);
        task = page.render({ canvas: target, viewport });
        return task.promise;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, number, near, width]);
  return (
    <div ref={frame} className="w-full max-w-4xl shrink-0">
      <canvas
        ref={canvas}
        aria-label={`Page ${number}`}
        className="block w-full bg-white shadow-sm"
        style={{ aspectRatio: `1 / ${aspect}` }}
      />
    </div>
  );
}
