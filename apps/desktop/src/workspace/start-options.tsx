import { useContext, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CompactLayoutContext } from "@/components/compact-layout";
import type { paneProfiles } from "./tab-profiles";

type Option = ReturnType<typeof paneProfiles>[number];

/**
 * The start screen's other ways to begin, beside the prompt box: everything the new-tab menu lists
 * after New chat, opened in this pane. On desktop they are one row, shown whole or not at all, since
 * how wide it is depends on the terminal profiles someone has saved. The new-tab menu offers the
 * same things when the row is hidden. A phone has no panes to widen, so there they wrap.
 */
export function StartOptions({
  options,
  disabled,
  onOpen,
}: {
  options: readonly Option[];
  disabled: boolean;
  onOpen: (option: Option) => void;
}) {
  const compact = useContext(CompactLayoutContext);
  const box = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const outer = box.current;
    const inner = row.current;
    if (compact || !outer || !inner) return;
    const measure = () =>
      setFits(inner.offsetWidth <= outer.clientWidth && inner.offsetHeight <= outer.clientHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    measure();
    return () => observer.disconnect();
  }, [compact]);
  return (
    <div ref={box} className={compact ? undefined : "flex h-full justify-center overflow-hidden"}>
      <div
        ref={row}
        role="group"
        aria-label="Start with"
        className={
          compact
            ? "flex flex-wrap justify-center gap-2"
            : // `invisible` also takes the buttons out of the Tab order and the accessibility tree.
              `flex h-fit w-max shrink-0 gap-2 ${fits ? "" : "invisible"}`
        }
      >
        {options
          .filter((option) => option.profile !== "chat")
          .map((option) => (
            <Button
              key={option.id}
              variant="outline"
              size="sm"
              className="text-muted-foreground"
              disabled={disabled}
              onClick={() => onOpen(option)}
            >
              <option.icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{option.label}</span>
            </Button>
          ))}
      </div>
    </div>
  );
}
