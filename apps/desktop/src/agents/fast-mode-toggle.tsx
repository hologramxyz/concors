import { useEffect, useRef } from "react";
import { Zap } from "lucide-react";
import { ControlTooltip } from "./control-tooltip";

/** Claude's Fast mode, switched with one press. */
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
    <ControlTooltip text={`Fast mode: ${on ? "On" : "Off"}`}>
      <button
        ref={button}
        type="button"
        aria-label="Fast mode"
        aria-pressed={on}
        disabled={disabled}
        className={`agent-control ${showLabel ? "agent-control-value" : ""} ${on ? "agent-control-on" : ""}`}
        onClick={() => {
          restoreFocus.current = document.activeElement === button.current;
          onToggle();
        }}
      >
        <Zap className="size-4" />
        {showLabel && <span className="truncate">Fast</span>}
      </button>
    </ControlTooltip>
  );
}
