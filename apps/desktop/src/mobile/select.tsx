import { useId, useRef, useState, type ReactNode } from "react";
import { Popover } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";

export interface MobileSelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
  description?: string;
}

/** Non-modal so a second tap on the trigger toggles once, without click-through reopening. */
export function MobileSelect({
  label,
  value,
  onValueChange,
  groups,
  placeholder,
  className = "",
  selectedLabel,
  hierarchy = false,
}: {
  label: string;
  value: string;
  onValueChange(value: string): void;
  groups: { label: string; options: MobileSelectOption[] }[];
  placeholder?: string;
  className?: string;
  selectedLabel?: ReactNode;
  hierarchy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const content = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: "", time: 0 });
  const selected = groups.flatMap((group) => group.options).find((item) => item.value === value);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        role="combobox"
        aria-haspopup="listbox"
        aria-label={label}
        aria-controls={id}
        aria-expanded={open}
        data-value={value}
        className={`mobile-select-trigger ${className}`}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {!selectedLabel && selected?.icon && (
          <span className="mobile-select-icon">{selected.icon}</span>
        )}
        <span className="min-w-0 truncate">{selectedLabel ?? selected?.label ?? placeholder}</span>
        <span className="mobile-select-chevron">
          <ChevronDown />
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={content}
          id={id}
          role="listbox"
          aria-label={label}
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className={`mobile-select-content ${hierarchy ? "mobile-pane-picker" : ""}`}
          onEscapeKeyDown={(event) => event.stopPropagation()}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const current = content.current;
            (
              current?.querySelector<HTMLElement>('[aria-selected="true"]') ??
              current?.querySelector<HTMLElement>('[role="option"]')
            )?.focus();
          }}
          onKeyDown={(event) => {
            const options = [
              ...(content.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []),
            ];
            const index = options.indexOf(document.activeElement as HTMLElement);
            let next: HTMLElement | undefined;
            if (event.key === "ArrowDown") next = options[(index + 1) % options.length];
            else if (event.key === "ArrowUp")
              next = options[(index - 1 + options.length) % options.length];
            else if (event.key === "Home") next = options[0];
            else if (event.key === "End") next = options.at(-1);
            else if (
              event.key.length === 1 &&
              event.key !== " " &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey
            ) {
              const now = Date.now();
              typeahead.current = {
                text:
                  (now - typeahead.current.time < 700 ? typeahead.current.text : "") +
                  event.key.toLowerCase(),
                time: now,
              };
              next = [...options.slice(index + 1), ...options.slice(0, index + 1)].find((option) =>
                option.dataset["label"]?.toLowerCase().startsWith(typeahead.current.text),
              );
            }
            if (next) {
              event.preventDefault();
              next.focus();
            }
          }}
        >
          {groups.map((group, index) => (
            <div
              key={index}
              role="group"
              aria-labelledby={`${id}-group-${index}`}
              className="mobile-select-group"
            >
              <div id={`${id}-group-${index}`} className="mobile-select-label">
                <span>{group.label}</span>
                {hierarchy && (
                  <span className="mobile-pane-count">
                    {group.options.length} {group.options.length === 1 ? "pane" : "panes"}
                  </span>
                )}
              </div>
              {group.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={value === option.value}
                  tabIndex={value === option.value ? 0 : -1}
                  data-value={option.value}
                  data-label={option.label}
                  className="mobile-select-option"
                  onClick={() => {
                    setOpen(false);
                    onValueChange(option.value);
                  }}
                >
                  {option.icon && <span className="mobile-select-icon">{option.icon}</span>}
                  <span className="min-w-0 flex-1">
                    {option.label}
                    {option.description && (
                      <span className="mobile-select-description">{option.description}</span>
                    )}
                  </span>
                  {value === option.value && <Check className="size-4 shrink-0" />}
                </button>
              ))}
            </div>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
