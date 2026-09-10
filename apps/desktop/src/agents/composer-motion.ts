import { useLayoutEffect, useRef, type RefObject } from "react";

/** Animate measured heights, including interrupted transitions, without relying on height:auto interpolation. */
export function useComposerMotion(
  form: RefObject<HTMLFormElement | null>,
  compact: boolean,
  expanded: boolean,
) {
  const height = useRef<number | null>(null);
  const animation = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const element = form.current;
    if (!compact || !element) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const cancel = () => {
      animation.current?.cancel();
      animation.current = null;
      height.current = element.getBoundingClientRect().height;
    };
    const motionChange = () => {
      if (reduced.matches) cancel();
    };
    const observer = new ResizeObserver(() => {
      if (!animation.current) height.current = element.getBoundingClientRect().height;
    });
    observer.observe(element);
    reduced.addEventListener("change", motionChange);
    return () => {
      observer.disconnect();
      reduced.removeEventListener("change", motionChange);
      cancel();
    };
  }, [compact, form]);
  useLayoutEffect(() => {
    const element = form.current;
    if (!compact || !element) return;
    const from = animation.current ? element.getBoundingClientRect().height : height.current;
    animation.current?.cancel();
    animation.current = null;
    const to = element.getBoundingClientRect().height;
    height.current = to;
    if (
      from === null ||
      Math.abs(from - to) < 1 ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const current = element.animate(
      [
        { height: from + "px", overflow: "clip" },
        { height: to + "px", overflow: "clip" },
      ],
      { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
    animation.current = current;
    current.onfinish = () => {
      if (animation.current !== current) return;
      animation.current = null;
      height.current = element.getBoundingClientRect().height;
    };
  }, [compact, expanded, form]);
}
