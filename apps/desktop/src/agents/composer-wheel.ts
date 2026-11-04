import { useEffect, type RefObject } from "react";
import { wheelScrollDelta } from "@/workspace/tab-strip-scroll";

/** Whether something from the wheel's target up to the composer has content of its own to scroll. */
function scrollsItself(target: Element | null, composer: Element) {
  for (let element = target; element && element !== composer; element = element.parentElement) {
    if (
      element.scrollHeight > element.clientHeight &&
      /auto|scroll/.test(getComputedStyle(element).overflowY)
    )
      return true;
  }
  return false;
}

/**
 * In a short pane the composer can be most of what shows, and part of it is out of view until the
 * pane scrolls. The wheel over it scrolls the pane, unless what is under the pointer has something
 * to scroll itself (a long draft, the queue), which keeps the engine's own behavior.
 */
export function useComposerWheel(form: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const composer = form.current;
    if (!enabled || !composer) return;
    // Not React's onWheel, which is passive and could not stop the page taking the same event.
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || scrollsItself(event.target as Element, composer)) return;
      const pane = composer.closest(".agent-conversation");
      if (!pane) return;
      const before = pane.scrollTop;
      pane.scrollTop += wheelScrollDelta(event, pane.clientHeight);
      if (pane.scrollTop !== before) event.preventDefault();
    };
    composer.addEventListener("wheel", onWheel, { passive: false });
    return () => composer.removeEventListener("wheel", onWheel);
  }, [form, enabled]);
}
