import { useEffect, useRef, useState } from "react";
import { useZoomAnchor, useZoomGestures } from "./zoom";
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
export default function PdfView({
  data,
  name,
  zoom,
  onZoom,
}: {
  data: Uint8Array;
  name: string;
  /** 1 fits the pages to the tab's width, up to a comfortable reading width. */
  zoom: number;
  onZoom: (zoom: number) => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useZoomGestures(scroller, zoom, onZoom);
  useZoomAnchor(scroller, zoom);
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
  return (
    // Always mounted, so the zoom gestures and scroll anchor have their element from the start.
    <div
      ref={scroller}
      aria-label={`Pages of ${name}`}
      // Focusable, so a click into the pages lets the keyboard scroll and zoom them.
      tabIndex={0}
      className="flex h-full flex-col gap-4 overflow-auto bg-muted/40 p-4 outline-none"
    >
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : !pdf ? (
        <p role="status" className="text-sm text-muted-foreground">
          Opening PDF…
        </p>
      ) : (
        Array.from({ length: pdf.numPages }, (_, index) => (
          <PdfPage key={index} pdf={pdf} number={index + 1} zoom={zoom} />
        ))
      )}
    </div>
  );
}

/** Canvas pixels per page at most: a zoomed-in page past this renders softer, not out of memory. */
const MAX_PAGE_PIXELS = 4096 * 4096;

function PdfPage({ pdf, number, zoom }: { pdf: PDFDocumentProxy; number: number; zoom: number }) {
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [aspect, setAspect] = useState(Math.SQRT2);
  const [width, setWidth] = useState(0);
  const [near, setNear] = useState(number <= 2);
  const drawn = useRef(false);
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
    const render = () =>
      void pdf
        .getPage(number)
        .then((page) => {
          if (cancelled) return;
          const natural = page.getViewport({ scale: 1 });
          const scale = Math.min(
            (width / natural.width) * window.devicePixelRatio,
            Math.sqrt(MAX_PAGE_PIXELS / (natural.width * natural.height)),
          );
          const viewport = page.getViewport({ scale });
          // Drawn aside and copied over when done, so a page being redrawn at a new zoom keeps
          // showing, stretched, instead of going blank.
          const drawing = document.createElement("canvas");
          drawing.width = Math.floor(viewport.width);
          drawing.height = Math.floor(viewport.height);
          task = page.render({ canvas: drawing, viewport });
          return task.promise.then(() => {
            if (cancelled) return;
            target.width = drawing.width;
            target.height = drawing.height;
            target.getContext("2d")?.drawImage(drawing, 0, 0);
            drawn.current = true;
          });
        })
        .catch(() => undefined);
    // The first drawing goes straight away; a redraw waits for a pinch or resize to settle.
    const timer = drawn.current ? setTimeout(render, 150) : (render(), undefined);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [pdf, number, near, width]);
  return (
    // Auto margins centre a page that fits and let one wider than the tab scroll from its left edge.
    <div
      ref={frame}
      className="mx-auto shrink-0"
      style={{ width: `calc(min(100%, 56rem) * ${zoom})` }}
    >
      <canvas
        ref={canvas}
        aria-label={`Page ${number}`}
        className="block w-full bg-white shadow-sm"
        style={{ aspectRatio: `1 / ${aspect}` }}
      />
    </div>
  );
}
