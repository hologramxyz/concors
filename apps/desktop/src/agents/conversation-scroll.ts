import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { useConversation } from "./conversation";
import type { MessageEntry } from "./message-index";

const EDGE = 200;
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
  const [atBottom, setAtBottom] = useState(true);
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
    // Growth below the fold never lowers scrollTop, so only an upward scroll leaves the bottom.
    // Judging by distance alone let a tall block that landed between our scroll and its event
    // (a code highlight, an image, a tool result) read as the user scrolling away.
    if (hasNewer) following.current = false;
    else if (distance < 80) following.current = true;
    else if (viewport.scrollTop < lastTop.current - 1) following.current = false;
    lastTop.current = viewport.scrollTop;
    setFollowing(following.current);
    setAtBottom(following.current);
    // A follower is pinned to the bottom, so skip measuring every message on each scroll event.
    if (!following.current) remember();
    edges();
  }, [hasNewer, setFollowing, remember, edges]);
  useLayoutEffect(() => {
    const viewport = scroll.current;
    if (!visible || !viewport?.clientHeight) return;
    if (reset.current !== historyReset) {
      reset.current = historyReset;
      following.current = true;
      anchor.current = null;
    }
    if (following.current && !hasNewer) viewport.scrollTop = viewport.scrollHeight;
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
  }, [items, historyReset, hasNewer, setFollowing, visible, remember]);
  useEffect(() => {
    const viewport = scroll.current;
    const content = viewport?.firstElementChild;
    if (!viewport || !content || !visible) return;
    const observer = new ResizeObserver(() => {
      if (following.current && !hasNewer) viewport.scrollTop = viewport.scrollHeight;
      remember();
      edges();
    });
    observer.observe(content);
    observer.observe(viewport);
    edges();
    return () => observer.disconnect();
  }, [visible, hasNewer, remember, edges]);
  const latest = () => {
    following.current = true;
    setFollowing(true);
    if (hasNewer || loading) void load("latest");
    else if (scroll.current) {
      scroll.current.scrollTop = scroll.current.scrollHeight;
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
