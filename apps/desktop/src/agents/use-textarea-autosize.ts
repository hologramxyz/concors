import { useLayoutEffect, useRef, type RefObject } from "react";

const metrics = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontStretch",
  "fontVariant",
  "fontFeatureSettings",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "textTransform",
  "textIndent",
  "tabSize",
  "wordBreak",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
] as const;

/** Measure outside the chat's layout tree; only a changed height may resize the real input. */
export function useTextareaAutosize(
  textarea: RefObject<HTMLTextAreaElement | null>,
  value: string,
  enabled: boolean,
  expanded: boolean,
) {
  const currentValue = useRef(value);
  const sizing = useRef<{ update: () => void; refresh: () => void } | null>(null);

  useLayoutEffect(() => {
    const input = textarea.current;
    if (!enabled || !input) return;
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    Object.assign(host.style, {
      position: "fixed",
      top: "0",
      left: "0",
      visibility: "hidden",
      pointerEvents: "none",
      contain: "strict",
      height: "0",
    });
    const mirror = document.createElement("div");
    mirror.setAttribute("data-composer-input-sizer", "");
    Object.assign(mirror.style, {
      boxSizing: "border-box",
      height: "max-content",
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
      borderStyle: "solid",
    });
    host.append(mirror);
    const previousHeight = input.style.height;
    let appliedHeight = "";
    let contentWidth = 0;
    let mounted = false;
    let refreshFrame: number | null = null;
    let heightFrame: number | null = null;
    let pendingHeight = "";
    const measured = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const height = entry.borderBoxSize[0]?.blockSize;
      if (height === undefined) return;
      const next = `${Math.ceil(height)}px`;
      pendingHeight = next;
      if (next === appliedHeight) return;
      if (heightFrame !== null) return;
      // Writing outside observer delivery avoids a textarea/mirror resize feedback loop.
      heightFrame = requestAnimationFrame(() => {
        heightFrame = null;
        if (pendingHeight === appliedHeight) return;
        appliedHeight = pendingHeight;
        // CSS still enforces min/max height, including short and compact panes.
        input.style.height = pendingHeight;
      });
    });
    const refresh = () => {
      if (contentWidth <= 0) return;
      const style = getComputedStyle(input);
      const values = metrics.map((property) => [property, style[property]] as const);
      // The content-box width excludes a scrollbar. Keep the mirror's wrapping equal to the input.
      const width =
        contentWidth +
        parseFloat(style.paddingLeft) +
        parseFloat(style.paddingRight) +
        parseFloat(style.borderLeftWidth) +
        parseFloat(style.borderRightWidth);
      for (const [property, value] of values) {
        if (mirror.style[property] !== value) mirror.style[property] = value;
      }
      const next = `${width}px`;
      if (mirror.style.width !== next) {
        host.style.width = next;
        mirror.style.width = next;
      }
      if (!mounted) {
        mounted = true;
        document.body.append(host);
        measured.observe(mirror);
      }
    };
    const scheduleRefresh = () => {
      if (refreshFrame !== null) return;
      refreshFrame = requestAnimationFrame(() => {
        refreshFrame = null;
        refresh();
      });
    };
    const resized = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      contentWidth = entry.contentRect.width;
      scheduleRefresh();
    });
    const update = () => {
      // A trailing newline needs a final line, even though it has no visible character yet.
      mirror.textContent = currentValue.current + " ";
    };
    sizing.current = { update, refresh: scheduleRefresh };
    update();
    resized.observe(input);
    document.fonts.addEventListener("loadingdone", scheduleRefresh);
    return () => {
      sizing.current = null;
      resized.disconnect();
      measured.disconnect();
      if (refreshFrame !== null) cancelAnimationFrame(refreshFrame);
      if (heightFrame !== null) cancelAnimationFrame(heightFrame);
      document.fonts.removeEventListener("loadingdone", scheduleRefresh);
      host.remove();
      input.style.height = previousHeight;
    };
  }, [textarea, enabled]);

  useLayoutEffect(() => {
    currentValue.current = value;
    sizing.current?.update();
  }, [value, enabled]);
  useLayoutEffect(() => {
    sizing.current?.refresh();
  }, [expanded, enabled]);
}
