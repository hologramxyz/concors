import { useEffect, useRef } from "react";
import { Zap } from "lucide-react";
import { ControlTooltip } from "./control-tooltip";

/** Claude's Fast mode: its icon, name and switch are one control, so a press anywhere toggles it. */
export function FastModeToggle({
  on,
  disabled,
  showLabel,
  onToggle,
}: {
  on: boolean;
  disabled: boolean;
  showLabel: boolean;
  onToggle: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  // The composer's controls are disabled while a change is saved, which drops focus from this one,
  // so someone toggling by keyboard would lose their place.
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!disabled && restoreFocus.current) button.current?.focus();
    if (!disabled) restoreFocus.current = false;
  }, [disabled]);
  return (
    <ControlTooltip text="Fast mode">
      <button
        ref={button}
        type="button"
        role="switch"
        aria-label="Fast mode"
        aria-checked={on}
        disabled={disabled}
        className="agent-control agent-control-switch"
        onClick={() => {
          restoreFocus.current = document.activeElement === button.current;
          onToggle();
        }}
      >
        <Zap className="size-4" />
        {showLabel && <span className="agent-control-switch-label">Fast</span>}
        <span
          aria-hidden="true"
          data-switch-track
          className={`flex h-[16px] w-[26px] shrink-0 items-center rounded-full p-[2px] transition-colors ${on ? "bg-(--link)" : "bg-muted-foreground/35"}`}
        >
          <span
            data-switch-knob
            className={`size-[12px] rounded-full bg-background transition-transform motion-reduce:transition-none dark:bg-foreground ${on ? "translate-x-[10px]" : ""}`}
          />
        </span>
      </button>
    </ControlTooltip>
  );
}
