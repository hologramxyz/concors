import { useId, useState, useRef, useEffect, type ReactNode } from "react";
import { Popover } from "radix-ui";
import { Check, Search } from "lucide-react";

export interface ControlOption {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
}
export function ControlPicker({
  label,
  value,
  options,
  icon,
  disabled,
  onSelect,
  footer,
  showValue = false,
  selectedLabel,
}: {
  label: string;
  value: string;
  options: ControlOption[];
  icon: ReactNode;
  disabled?: boolean;
  onSelect: (id: string) => void;
  footer?: ReactNode;
  showValue?: boolean;
  selectedLabel?: string;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null),
    restoreFocus = useRef(false);
  useEffect(() => {
    if (!open && !disabled && restoreFocus.current) {
      trigger.current?.focus();
      restoreFocus.current = false;
    }
  }, [open, disabled]);
  const currentLabel =
    selectedLabel ?? options.find((option) => option.id === value)?.label ?? value;
  const visible = options.filter((o) =>
    `${o.label} ${o.description ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  const select = (next: string) => {
    restoreFocus.current = true;
    onSelect(next);
    setOpen(false);
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setQuery("");
        setActive(0);
      }}
    >
      <Popover.Trigger
        ref={trigger}
        type="button"
        aria-label={label}
        data-value={value}
        title={`${label}: ${currentLabel}`}
        disabled={disabled}
        className={`agent-control ${showValue ? "agent-control-value" : ""}`}
      >
        {icon}
        {showValue && <span className="truncate">{currentLabel}</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-50 w-72 max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) =>
                Math.max(0, Math.min(visible.length - 1, a + (e.key === "ArrowDown" ? 1 : -1))),
              );
            }
            if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
              e.preventDefault();
              const option = visible[active];
              if (option) select(option.id);
            }
          }}
        >
          <div className="flex items-center gap-2 border-b px-2 pt-1 pb-2 text-muted-foreground">
            <Search className="size-4" />
            <input
              role="combobox"
              aria-label={`Search ${label.toLowerCase()}`}
              aria-expanded="true"
              aria-controls={id}
              aria-activedescendant={visible[active] ? `${id}-${active}` : undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder={label}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <div
            id={id}
            role="listbox"
            aria-label={label}
            className="chat-scroll max-h-72 overflow-auto py-1"
          >
            {visible.map((option, index) => (
              <button
                type="button"
                role="option"
                id={`${id}-${index}`}
                aria-selected={value === option.id}
                key={option.id}
                onMouseMove={() => setActive(index)}
                onClick={() => select(option.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm ${active === index ? "bg-accent" : "hover:bg-accent"}`}
              >
                {option.icon}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  {option.description && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  )}
                </span>
                {value === option.id && <Check className="size-4 shrink-0" />}
              </button>
            ))}
            {!visible.length && <p className="p-3 text-sm text-muted-foreground">No matches</p>}
          </div>
          {footer}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
