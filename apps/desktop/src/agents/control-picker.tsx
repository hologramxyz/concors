import { useContext, useId, useState, useRef, useEffect, type ReactNode } from "react";
import { ComposerSurfaceContext } from "./composer-expansion";
import { Popover } from "radix-ui";
import { ArrowLeft, Check, ChevronRight, Search } from "lucide-react";

export interface ControlOption {
  id: string;
  label: string;
  description?: string | undefined;
  icon?: ReactNode;
}
export interface ControlGroup extends ControlOption {
  options: ControlOption[];
  emptyMessage?: string | undefined;
}
export function ControlPicker({
  label,
  value,
  options,
  icon,
  disabled,
  onSelect,
  groups,
  selectedGroupId,
  showValue = false,
  selectedLabel,
  onOpen,
  onGroupChange,
  status,
}: {
  label: string;
  value: string;
  options: ControlOption[];
  icon: ReactNode;
  disabled?: boolean;
  onSelect: (id: string, groupId?: string) => void;
  groups?: ControlGroup[];
  selectedGroupId?: string;
  showValue?: boolean;
  selectedLabel?: string;
  onOpen?: () => void;
  onGroupChange?: (id: string) => void;
  status?: string | undefined;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0),
    [groupId, setGroupId] = useState(selectedGroupId);
  const id = useId();
  const composerSurface = useContext(ComposerSurfaceContext);
  const trigger = useRef<HTMLButtonElement>(null),
    search = useRef<HTMLInputElement>(null),
    list = useRef<HTMLDivElement>(null),
    restoreFocus = useRef(false);
  useEffect(() => {
    if (!open && !disabled && restoreFocus.current) {
      trigger.current?.focus();
      restoreFocus.current = false;
    }
  }, [open, disabled]);
  const currentLabel =
    selectedLabel ?? options.find((option) => option.id === value)?.label ?? value;
  const group = groups?.find((item) => item.id === groupId);
  const choosingProvider = !!groups && !group;
  const searchLabel = choosingProvider ? "Providers" : label;
  const visible = (groups ? (group?.options ?? groups) : options).filter((o) =>
    `${o.label} ${o.description ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  const navigate = (next: string | undefined) => {
    setGroupId(next);
    if (next) onGroupChange?.(next);
    setQuery("");
    setActive(0);
    if (list.current) list.current.scrollTop = 0;
    search.current?.focus();
  };
  const select = (next: string) => {
    if (choosingProvider) {
      navigate(next);
      return;
    }
    restoreFocus.current = true;
    onSelect(next, group?.id);
    setOpen(false);
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onOpen?.();
        setQuery("");
        setActive(0);
        setGroupId(selectedGroupId);
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
          data-composer-surface={composerSurface}
          side="top"
          align="start"
          sideOffset={8}
          className="z-50 w-72 max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            search.current?.focus();
          }}
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
          {groups && (
            <div className="flex min-h-10 items-center gap-2 border-b px-2 pb-1.5 text-sm">
              {group && (
                <button
                  type="button"
                  aria-label="Back to providers"
                  onClick={() => navigate(undefined)}
                  className="flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <ArrowLeft className="size-4" />
                </button>
              )}
              {group?.icon}
              <span className="truncate font-medium">{group?.label ?? "Providers"}</span>
            </div>
          )}
          <div className="flex items-center gap-2 border-b px-2 pt-1 pb-2 text-muted-foreground">
            <Search className="size-4" />
            <input
              ref={search}
              role="combobox"
              aria-label={`Search ${searchLabel.toLowerCase()}`}
              aria-expanded="true"
              aria-controls={id}
              aria-activedescendant={visible[active] ? `${id}-${active}` : undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder={searchLabel}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <div
            ref={list}
            id={id}
            role="listbox"
            aria-label={searchLabel}
            className="chat-scroll max-h-72 overflow-auto py-1"
          >
            {visible.map((option, index) => (
              <button
                type="button"
                role="option"
                id={`${id}-${index}`}
                aria-selected={
                  choosingProvider
                    ? selectedGroupId === option.id
                    : (!groups || selectedGroupId === groupId) && value === option.id
                }
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
                {choosingProvider ? (
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  (!groups || selectedGroupId === groupId) &&
                  value === option.id && <Check className="size-4 shrink-0" />
                )}
              </button>
            ))}
            {!visible.length && (
              <p className="p-3 text-sm text-muted-foreground">
                {group?.emptyMessage ?? "No matches"}
              </p>
            )}
          </div>
          {status && (
            <p role="status" className="border-t px-2 py-2 text-xs text-muted-foreground">
              {status}
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
