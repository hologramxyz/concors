import { useEffect, useLayoutEffect, type RefObject } from "react";

/**
 * The text styles a backdrop copies from the message box, so its words land exactly where the
 * box's do: everything that decides a glyph's width, a line's height or where a line breaks.
 */
const COPIED = [
  "boxSizing",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontStretch",
  "fontKerning",
  "fontFeatureSettings",
  "fontVariationSettings",
  "fontVariantLigatures",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "textTransform",
  "textIndent",
  "textRendering",
  "tabSize",
  "whiteSpace",
  "overflowWrap",
  "wordBreak",
  "direction",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "opacity",
] as const;

/** Lays `copy` over `input`'s box with its text styles and scroll position. */
function syncBackdrop(input: HTMLTextAreaElement | null, copy: HTMLDivElement | null) {
  const parent = copy?.offsetParent;
  if (!input || !copy || !(parent instanceof HTMLElement)) return;
  const style = getComputedStyle(input);
  for (const name of COPIED) copy.style[name] = style[name];
  const box = input.getBoundingClientRect();
  const frame = parent.getBoundingClientRect();
  const sides = (a: string, b: string) => parseFloat(a) + parseFloat(b);
  copy.style.top = `${box.top - frame.top - parent.clientTop}px`;
  copy.style.left = `${box.left - frame.left - parent.clientLeft}px`;
  // Its client box plus borders: a scrollbar narrows where the box's lines wrap.
  copy.style.width = `${input.clientWidth + sides(style.borderLeftWidth, style.borderRightWidth)}px`;
  copy.style.height = `${input.clientHeight + sides(style.borderTopWidth, style.borderBottomWidth)}px`;
  copy.scrollTop = input.scrollTop;
}

/**
 * Keeps `backdrop`, a copy of the message drawn behind `textarea`, in step with it: the same text
 * styles, laid over the box's own border box less any scrollbar, scrolled with it. It follows
 * every draft change, the box's scrolling, any resize (the box growing as it is typed into, the
 * window, the zoom) and fonts loading. The box itself is left exactly as it is.
 */
export function useMentionBackdrop(
  textarea: RefObject<HTMLTextAreaElement | null>,
  backdrop: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  useLayoutEffect(() => {
    if (enabled) syncBackdrop(textarea.current, backdrop.current);
  });
  useEffect(() => {
    const input = textarea.current;
    if (!enabled || !input) return;
    const scrolled = () => {
      if (backdrop.current) backdrop.current.scrollTop = input.scrollTop;
    };
    const resized = new ResizeObserver(() => syncBackdrop(input, backdrop.current));
    resized.observe(input);
    if (input.parentElement) resized.observe(input.parentElement);
    input.addEventListener("scroll", scrolled, { passive: true });
    let live = true;
    void document.fonts?.ready.then(() => live && syncBackdrop(input, backdrop.current));
    return () => {
      live = false;
      resized.disconnect();
      input.removeEventListener("scroll", scrolled);
    };
  }, [enabled, textarea, backdrop]);
}
