import { createContext, useContext, useId, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "cn";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Runs a chosen item: at once, or once the sheet has gone. */
type Choose = (action: () => void, immediate?: boolean) => void;
const ChooseContext = createContext<Choose>((action) => action());

/**
 * A row's "…" menu as a phone shows it: the bottom sheet the phone's other menus use, titled with
 * the row's name, in place of desktop's dropdown. Choosing an item closes the sheet first and runs
 * the item once it has gone, so a dialog it opens never stacks on it.
 */
export function RowMenuSheet({
  label,
  title,
  className,
  children,
  icon,
}: {
  /** The trigger's accessible name. */
  label: string;
  /** The sheet's title: the row's name. */
  title: string;
  className?: string;
  /** The trigger's icon. */
  icon: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const next = useRef<(() => void) | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const choose: Choose = (action, immediate = false) => {
    setOpen(false);
    if (immediate) action();
    else next.current = action;
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={className}
        onClick={() => setOpen(true)}
      >
        {icon}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="mobile-select-sheet mobile-row-sheet"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            list.current
              ?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')
              ?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const action = next.current;
            next.current = null;
            // The item's next step takes focus; otherwise it goes back to the "…" it came from.
            if (action) action();
            else
              requestAnimationFrame(() => {
                const target = trigger.current;
                if (target?.isConnected && !target.closest("[inert]"))
                  target.focus({ preventScroll: true });
              });
          }}
        >
          <DialogHeader>
            <DialogTitle className="truncate">{title}</DialogTitle>
          </DialogHeader>
          <div
            ref={list}
            role="menu"
            aria-label={title}
            className="mobile-select-sheet-list"
            onKeyDown={(event) => {
              const items = [
                ...(list.current?.querySelectorAll<HTMLElement>(
                  '[role^="menuitem"]:not(:disabled)',
                ) ?? []),
              ];
              const index = items.indexOf(document.activeElement as HTMLElement);
              const target =
                event.key === "ArrowDown"
                  ? items[(index + 1) % items.length]
                  : event.key === "ArrowUp"
                    ? items[(index - 1 + items.length) % items.length]
                    : event.key === "Home"
                      ? items[0]
                      : event.key === "End"
                        ? items.at(-1)
                        : undefined;
              if (!target) return;
              event.preventDefault();
              target.focus();
            }}
          >
            <ChooseContext value={choose}>{children}</ChooseContext>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RowMenuItem({
  icon,
  children,
  onSelect,
  disabled = false,
  destructive = false,
  immediate = false,
}: {
  icon: ReactNode;
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
  /** Runs while the sheet closes, for a step whose owner closes along with it. */
  immediate?: boolean;
}) {
  const choose = useContext(ChooseContext);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      data-variant={destructive ? "destructive" : undefined}
      className="mobile-select-option disabled:opacity-50"
      onClick={() => choose(onSelect, immediate)}
    >
      <span className="mobile-select-icon">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export function RowMenuRadioItem({
  icon,
  children,
  checked,
  onSelect,
  disabled = false,
}: {
  icon: ReactNode;
  children: ReactNode;
  checked: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  const choose = useContext(ChooseContext);
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      disabled={disabled}
      className="mobile-select-option disabled:opacity-50"
      onClick={() => choose(onSelect)}
    >
      <span className="mobile-select-icon">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {checked && <Check className="size-4 shrink-0" />}
    </button>
  );
}

/** Items under a label, in the style of the phone's other sheets. */
export function RowMenuGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="mobile-select-group">
      <div id={id} className="mobile-select-label">
        {label}
      </div>
      {children}
    </div>
  );
}

export function RowMenuSeparator({ className }: { className?: string }) {
  return <div role="separator" className={cn("mobile-row-sheet-separator", className)} />;
}
