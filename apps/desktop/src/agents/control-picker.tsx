import { Fragment, useContext, useId, useState, useRef, useEffect, type ReactNode } from "react";
import { ControlTooltip } from "./control-tooltip";
import { ComposerSurfaceContext } from "./composer-expansion";
import { CompactLayoutContext } from "@/components/compact-layout";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Popover } from "radix-ui";
import { ArrowLeft, Check, ChevronRight, Search } from "lucide-react";

export interface ControlOption {
  id: string;
  label: string;
  description?: string | undefined;
  icon?: ReactNode;
  /** Listed below a divider, as older models are. */
  older?: boolean | undefined;
}
export interface ControlGroup extends ControlOption {
  options: ControlOption[];
  emptyMessage?: string | undefined;
  status?: string | undefined;
  /** Shown under the group's options, e.g. an available CLI update. */
  footer?: ReactNode;
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
  primary = false,
  shortcut,
  selectedLabel,
  onOpen,
  onGroupChange,
  status,
  notice,
  searchable = true,
  mobileDrawer = false,
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
  /** Keeps its label in narrow composers, where the other pickers show only their icons. */
  primary?: boolean;
  /** Keyboard action available from the composer, when this control has one. */
  shortcut?: string;
  selectedLabel?: string;
  onOpen?: () => void;
  onGroupChange?: (id: string) => void;
  status?: string | undefined;
  /** Marks the trigger with a dot and adds this to its tooltip, e.g. an update for the agent. */
  notice?: string | undefined;
  /** A menu of a few options has nothing worth searching. */
  searchable?: boolean;
  /** Use the shared bottom drawer in phone hosts, retaining the desktop popover. */
  mobileDrawer?: boolean;
}) {
  const compact = useContext(CompactLayoutContext);
  const drawer = compact && mobileDrawer;
  const Root = drawer ? Dialog : Popover.Root;
  const Trigger = drawer ? DialogTrigger : Popover.Trigger;
  // A touch screen has no keyboard position to show, and the first row would read as the selection.
  const resting = compact ? -1 : 0;
  // On a phone the field takes a row and the keyboard takes half the screen, for a few options.
  const searching = searchable && !(compact && !groups && options.length <= 6);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(resting),
    [groupId, setGroupId] = useState(selectedGroupId),
    // Closing returns focus to the trigger, which would reopen its tooltip on its own; `quiet`
    // holds it back until the pointer returns or focus moves on. Every close must set it.
    [quiet, setQuiet] = useState(false);
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
  const statusText = group?.status ?? status;
  const choosingProvider = !!groups && !group;
  const searchLabel = choosingProvider ? "Providers" : group ? "Models" : label;
  const visible = (groups ? (group?.options ?? groups) : options).filter((o) =>
    `${o.label} ${o.description ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  const navigate = (next: string | undefined) => {
    setGroupId(next);
    if (next) onGroupChange?.(next);
    setQuery("");
    setActive(resting);
    if (list.current) list.current.scrollTop = 0;
    (drawer ? list.current : (search.current ?? list.current))?.focus();
  };
  const select = (next: string) => {
    if (choosingProvider) {
      navigate(next);
      return;
    }
    restoreFocus.current = true;
    onSelect(next, group?.id);
    setOpen(false);
    setQuiet(true);
  };
  const triggerButton = (
    <Trigger
      ref={trigger}
      type="button"
      aria-label={label}
      aria-description={notice}
      data-value={value}
      disabled={disabled}
      className={`agent-control ${showValue ? "agent-control-value" : ""} ${primary ? "agent-control-primary" : ""}`}
      onPointerEnter={() => setQuiet(false)}
      onBlur={() => setQuiet(false)}
    >
      {icon}
      {showValue && <span className="truncate">{currentLabel}</span>}
      {notice && <span aria-hidden="true" className="agent-control-dot" />}
    </Trigger>
  );
  const heading = groups && (
    <>
      {group && (
        <button
          type="button"
          aria-label="Back to providers"
          onClick={() => navigate(undefined)}
          className="mobile-tap-target flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <ArrowLeft className="size-4" />
        </button>
      )}
      {group?.icon}
      {drawer ? (
        <DialogTitle>{group?.label ?? "Providers"}</DialogTitle>
      ) : (
        <span className="truncate font-medium">{group?.label ?? "Providers"}</span>
      )}
    </>
  );
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) =>
        Math.max(0, Math.min(visible.length - 1, a + (e.key === "ArrowDown" ? 1 : -1))),
      );
    }
    if (e.key === "Enter" && (e.target === search.current || e.target === list.current)) {
      e.preventDefault();
      const option = visible[active];
      if (option) select(option.id);
    }
  };
  const content = (
    <>
      {!drawer && groups && (
        <div className="flex min-h-10 items-center gap-2 border-b px-2 pb-1.5 text-sm">
          {heading}
        </div>
      )}
      {searching && (
        <div className="flex shrink-0 items-center gap-2 border-b px-2 pt-1 pb-2 text-muted-foreground">
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
            placeholder={group ? "Search models" : searchLabel}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
      )}
      <div
        ref={list}
        id={id}
        role="listbox"
        aria-label={searchLabel}
        // A phone opens without raising its keyboard; search takes focus only when tapped.
        tabIndex={drawer || !searching ? -1 : undefined}
        aria-activedescendant={
          (drawer || !searching) && visible[active] ? `${id}-${active}` : undefined
        }
        className={`chat-scroll min-h-0 overflow-auto outline-none ${drawer ? "max-h-[50dvh]" : "max-h-72"} ${searching ? "py-1" : ""}`}
      >
        {visible.map((option, index) => (
          <Fragment key={option.id}>
            {option.older && !visible[index - 1]?.older && index > 0 && (
              <div role="none" data-older-models className="mx-2 my-1 border-t" />
            )}
            <button
              type="button"
              role="option"
              id={`${id}-${index}`}
              aria-selected={
                choosingProvider
                  ? selectedGroupId === option.id
                  : (!groups || selectedGroupId === groupId) && value === option.id
              }
              onMouseMove={() => setActive(index)}
              onClick={() => select(option.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm ${drawer ? "min-h-11" : ""} ${active === index ? "bg-accent" : "hover:bg-accent"}`}
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
                <>
                  {selectedGroupId === option.id && <Check className="size-4 shrink-0" />}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </>
              ) : (
                (!groups || selectedGroupId === groupId) &&
                value === option.id && <Check className="size-4 shrink-0" />
              )}
            </button>
          </Fragment>
        ))}
        {!visible.length && (
          <p className="p-3 text-sm text-muted-foreground">{group?.emptyMessage ?? "No matches"}</p>
        )}
      </div>
      {group?.footer}
      {statusText && (
        <p role="status" className="border-t px-2 py-2 text-xs text-muted-foreground">
          {statusText}
        </p>
      )}
    </>
  );
  return (
    <Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuiet(true);
        if (next) onOpen?.();
        setQuery("");
        setActive(resting);
        setGroupId(selectedGroupId);
      }}
    >
      <ControlTooltip
        text={`${label}: ${currentLabel}${notice ? `. ${notice}` : ""}`}
        shortcut={shortcut}
        hidden={open || quiet}
      >
        {triggerButton}
      </ControlTooltip>
      {drawer ? (
        <DialogContent
          aria-label={label}
          // Keep the drawer's accessible name stable while its provider heading changes.
          aria-labelledby={undefined}
          aria-describedby={undefined}
          data-composer-surface={composerSurface}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            list.current?.focus();
          }}
          onKeyDown={onKeyDown}
        >
          <DialogHeader>
            <div className="flex min-h-11 items-center gap-2">
              {heading ?? <DialogTitle>{label}</DialogTitle>}
            </div>
          </DialogHeader>
          {content}
        </DialogContent>
      ) : (
        <Popover.Portal>
          <Popover.Content
            data-composer-surface={composerSurface}
            side="top"
            align="start"
            sideOffset={8}
            className="z-50 w-72 max-w-[calc(100vw-24px)] overflow-hidden rounded-[calc(var(--radius-lg)+(0.375rem+1px)*var(--concentric))] border bg-popover p-1.5 text-popover-foreground shadow-lg"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              (search.current ?? list.current)?.focus();
            }}
            onKeyDown={onKeyDown}
          >
            {content}
          </Popover.Content>
        </Popover.Portal>
      )}
    </Root>
  );
}
