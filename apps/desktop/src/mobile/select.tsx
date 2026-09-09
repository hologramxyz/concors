import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Popover } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export interface MobileSelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
  description?: string;
}

/** Shared selection behavior; workspace/machine pickers use sheets, settings use popovers. */
export function MobileSelect({
  label,
  value,
  onValueChange,
  groups,
  placeholder,
  className = "",
  selectedLabel,
  hierarchy = false,
  presentation = "popover",
}: {
  label: string;
  value: string;
  onValueChange(value: string): void;
  groups: { label: string; options: MobileSelectOption[] }[];
  placeholder?: string;
  className?: string;
  selectedLabel?: ReactNode;
  hierarchy?: boolean;
  presentation?: "popover" | "sheet";
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const content = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const typeahead = useRef({ text: "", time: 0 });
  const selected = groups.flatMap((group) => group.options).find((item) => item.value === value);
  const focusSelection = (event: Event) => {
    const current = content.current;
    const option =
      current?.querySelector<HTMLElement>('[aria-selected="true"]') ??
      current?.querySelector<HTMLElement>('[role="option"]');
    if (option) {
      event.preventDefault();
      option.focus({ preventScroll: true });
      option.scrollIntoView({ block: "nearest" });
    }
  };
  const navigate = (event: KeyboardEvent<HTMLElement>) => {
    const options = [...(content.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const index = options.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    if (event.key === "ArrowDown") next = options[(index + 1) % options.length];
    else if (event.key === "ArrowUp") next = options[(index - 1 + options.length) % options.length];
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
  };
  const button = (
    <button
      ref={trigger}
      type="button"
      role="combobox"
      aria-haspopup={presentation === "sheet" ? "dialog" : "listbox"}
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
    </button>
  );
  const items = groups.map((group, index) => (
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
  ));
  if (presentation === "sheet")
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{button}</DialogTrigger>
        <DialogContent
          id={id}
          aria-describedby={undefined}
          className={`mobile-select-sheet ${hierarchy ? "mobile-workspace-sheet" : ""}`}
          onOpenAutoFocus={focusSelection}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(() => {
              if (!document.querySelector('[data-slot="dialog-content"][data-state="open"]'))
                trigger.current?.focus({ preventScroll: true });
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
          </DialogHeader>
          <div
            ref={content}
            role="listbox"
            aria-label={label}
            onKeyDown={navigate}
            className={`mobile-select-sheet-list ${hierarchy ? "mobile-pane-picker" : ""}`}
          >
            {items}
            {!groups.some((group) => group.options.length) && (
              <p className="p-3 text-sm text-muted-foreground">No options available.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{button}</Popover.Trigger>
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
          onOpenAutoFocus={focusSelection}
          onKeyDown={navigate}
        >
          {items}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
