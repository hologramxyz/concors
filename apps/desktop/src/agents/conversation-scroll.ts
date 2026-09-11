import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { useConversation } from "./conversation";

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
    if (!visible || !viewport?.clientHeight || !ready || loading || error) return;
    const short = viewport.scrollHeight <= viewport.clientHeight + 1;
    if (hasEarlier && viewport.scrollTop < EDGE && (!following.current || short))
      void load("earlier");
    else if (hasNewer && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < EDGE)
      void load("newer");
  }, [visible, ready, loading, error, hasEarlier, hasNewer, load]);
  const onScroll = useCallback(() => {
    const viewport = scroll.current;
    if (!viewport?.clientHeight) return;
    following.current =
      !hasNewer && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80;
    setFollowing(following.current);
    setAtBottom(following.current);
    remember();
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
  return { scroll, onScroll, atBottom, latest };
}
