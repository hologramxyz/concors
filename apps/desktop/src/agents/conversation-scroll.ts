import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { useConversation } from "./conversation";
import type { MessageEntry } from "./message-index";

const EDGE = 200;
/** How long after a wheel or key press its scroll (smooth or kinetic) is still the user's. */
const INPUT = 400;
const UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);
const DOWN_KEYS = new Set(["ArrowDown", "PageDown", "End"]);
/** Anchor a visible message, not total height: either edge may be trimmed as pages move. */
export function useConversationScroll(
  conversation: ReturnType<typeof useConversation>,
  visible: boolean,
) {
  const {
    ready,
    loading,
    error,
    hasEarlier,
    hasNewer,
    load,
    setFollowing,
    items,
    reset: historyReset,
  } = conversation;
  const scroll = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const following = useRef(true);
  const lastTop = useRef(0);
  const jumping = useRef(false);
  const reset = useRef(-1);
  const newer = useRef(hasNewer);
  // Only scrolling the user caused may leave the bottom. Layout churn (a card collapsing, the
  // footer resizing, code highlighting in) moves scrollTop too, and reads like scrolling up.
  const input = useRef({ until: 0, up: false, pointer: false, touch: false });
  const [atBottom, setAtBottom] = useState(true);
  const userScrolling = useCallback(() => {
    const { until, pointer, touch } = input.current;
    return pointer || touch || performance.now() < until;
  }, []);
  /** An upward wheel, key or drag is in flight: don't yank the viewport back down under it. */
  const holding = useCallback(() => {
    const { until, up, pointer, touch } = input.current;
    return pointer || touch || (up && performance.now() < until);
  }, []);
  const pin = useCallback(() => {
    const viewport = scroll.current;
    if (!viewport || holding()) return;
    viewport.scrollTop = viewport.scrollHeight;
    lastTop.current = viewport.scrollTop;
  }, [holding]);
  const remember = useCallback(() => {
    const viewport = scroll.current;
    if (!viewport?.clientHeight) return;
    const top = viewport.getBoundingClientRect().top;
    const item = Array.from(viewport.querySelectorAll<HTMLElement>("[data-message-id]")).find(
      (item) => item.getBoundingClientRect().bottom > top,
    );
    anchor.current = item
      ? { id: item.dataset.messageId ?? "", top: item.getBoundingClientRect().top - top }
      : null;
  }, []);
  const edges = useCallback(() => {
    const viewport = scroll.current;
    if (!visible || !viewport?.clientHeight || !ready || loading || error || jumping.current)
      return;
    const short = viewport.scrollHeight <= viewport.clientHeight + 1;
    if (hasEarlier && viewport.scrollTop < EDGE && (!following.current || short))
      void load("earlier");
    else if (hasNewer && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < EDGE)
      void load("newer");
  }, [visible, ready, loading, error, hasEarlier, hasNewer, load]);
  const onScroll = useCallback(() => {
    const viewport = scroll.current;
    if (!viewport?.clientHeight || jumping.current) return;
    const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const user = userScrolling();
    // At the very bottom a lower scrollTop is a clamp (the viewport grew), never a scroll up.
    if (hasNewer) following.current = false;
    else if (distance < 2) following.current = true;
    else if (user && viewport.scrollTop < lastTop.current - 1) following.current = false;
    else if (user && distance < 80) following.current = true;
    lastTop.current = viewport.scrollTop;
    setFollowing(following.current);
    setAtBottom(following.current);
    // A follower is pinned to the bottom, so skip measuring every message on each scroll event.
    if (!following.current) remember();
    edges();
  }, [hasNewer, setFollowing, remember, edges, userScrolling]);
  useLayoutEffect(() => {
    newer.current = hasNewer;
    const viewport = scroll.current;
    if (!visible || !viewport?.clientHeight) return;
    if (reset.current !== historyReset) {
      reset.current = historyReset;
      following.current = true;
      anchor.current = null;
    }
    if (following.current && !hasNewer) pin();
    else if (anchor.current) {
      const saved = anchor.current;
      const item = Array.from(viewport.querySelectorAll<HTMLElement>("[data-message-id]")).find(
        (item) => item.dataset.messageId === saved.id,
      );
      if (item)
        viewport.scrollTop +=
          item.getBoundingClientRect().top - viewport.getBoundingClientRect().top - saved.top;
    }
    setFollowing(following.current && !hasNewer);
    setAtBottom(following.current && !hasNewer);
    remember();
  }, [items, historyReset, hasNewer, setFollowing, visible, remember, pin]);
  useEffect(() => {
    const viewport = scroll.current;
    const content = viewport?.firstElementChild;
    if (!viewport || !content || !visible) return;
    const observer = new ResizeObserver(() => {
      if (following.current && !hasNewer) pin();
      remember();
      edges();
    });
    observer.observe(content);
    observer.observe(viewport);
    edges();
    return () => observer.disconnect();
  }, [visible, hasNewer, remember, edges, pin]);
  useEffect(() => {
    const viewport = scroll.current;
    if (!viewport) return;
    let timer = 0;
    // An upward scroll nothing consumed (a nested scroller, the top) leaves us following, and
    // content that grew while we held still needs pinning.
    const settle = () => {
      if (following.current && !newer.current) pin();
    };
    const intend = (up: boolean) => {
      input.current.until = performance.now() + INPUT;
      input.current.up = up;
      clearTimeout(timer);
      timer = window.setTimeout(settle, INPUT);
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || !event.deltaY) return;
      intend(event.deltaY < 0);
    };
    const key = (event: KeyboardEvent) => {
      if ((event.target as Element).closest("input, textarea, [contenteditable]")) return;
      const up = UP_KEYS.has(event.key) || (event.key === " " && event.shiftKey);
      if (up || DOWN_KEYS.has(event.key) || event.key === " ") intend(up);
    };
    // Dragging the scrollbar, selecting text past the edge, or panning a touch screen.
    const press = (event: PointerEvent) => {
      if (event.pointerType !== "touch") input.current.pointer = true;
    };
    const release = () => {
      if (!input.current.pointer) return;
      input.current.pointer = false;
      settle();
    };
    // Some engines swallow pointerup after a scrollbar drag.
    const move = (event: PointerEvent) => {
      if (!event.buttons) release();
    };
    const touch = () => {
      input.current.touch = true;
    };
    const untouch = () => {
      input.current.touch = false;
      intend(true); // momentum keeps scrolling after the finger lifts
    };
    const blur = () => {
      input.current.touch = false;
      release();
    };
    viewport.addEventListener("wheel", wheel, { passive: true });
    viewport.addEventListener("keydown", key);
    viewport.addEventListener("pointerdown", press);
    viewport.addEventListener("touchstart", touch, { passive: true });
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("touchend", untouch);
    window.addEventListener("touchcancel", untouch);
    window.addEventListener("blur", blur);
    return () => {
      clearTimeout(timer);
      viewport.removeEventListener("wheel", wheel);
      viewport.removeEventListener("keydown", key);
      viewport.removeEventListener("pointerdown", press);
      viewport.removeEventListener("touchstart", touch);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("touchend", untouch);
      window.removeEventListener("touchcancel", untouch);
      window.removeEventListener("blur", blur);
    };
  }, [pin]);
  const latest = () => {
    following.current = true;
    setFollowing(true);
    if (hasNewer || loading) void load("latest");
    else if (scroll.current) {
      scroll.current.scrollTop = scroll.current.scrollHeight;
      lastTop.current = scroll.current.scrollTop;
      setAtBottom(true);
    }
  };
  const jumpToMessage = async (entry: MessageEntry) => {
    following.current = false;
    setFollowing(false);
    setAtBottom(false);
    anchor.current = null;
    jumping.current = true;
    try {
      await conversation.reveal(entry.position);
      // Commit the fetched window before measuring or resuming edge loading.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const viewport = scroll.current;
      const target = viewport?.querySelector<HTMLElement>(
        `[data-user-message="${CSS.escape(entry.id)}"]`,
      );
      if (!viewport || !target) throw new Error("This message is no longer available.");
      const inset = Math.max(
        16,
        Number.parseFloat(getComputedStyle(viewport).scrollPaddingTop) || 0,
      );
      viewport.scrollTop +=
        target.getBoundingClientRect().top - viewport.getBoundingClientRect().top - inset;
      target.focus({ preventScroll: true });
      target.animate([{ backgroundColor: "var(--muted)" }, { backgroundColor: "transparent" }], {
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700,
      });
      remember();
    } finally {
      requestAnimationFrame(() => {
        jumping.current = false;
        // The DOM may contain a different window than this callback's render.
        scroll.current?.dispatchEvent(new Event("scroll"));
      });
    }
  };
  return { scroll, onScroll, atBottom, latest, jumpToMessage };
}
