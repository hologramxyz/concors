import { useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { CompactLayoutContext } from "@/components/compact-layout";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CommandId } from "@/shortcuts/bindings";
import { BoundKeyChips } from "@/shortcuts/key-chips";

/**
 * Where a tooltip sits. Sidebar rows and their icons open beside the sidebar, level with the row,
 * so they never cover another row or a row's "…" menu. Title-bar icons, and other rows of icons,
 * open below, where a tooltip beside them would cover the next icon. Inside a menu or dialog, whose
 * rows someone is scanning, it opens sooner and just right of its row: beside the sidebar it would
 * sit behind the dialog.
 */
type TooltipPlace = "sidebar" | "title-bar" | "menu";

const HOVER_DELAY = 600;
const MENU_DELAY = 300;
/** Sweeping along a list shows each row's tooltip at once, after the first has waited. */
const SWEEP_WINDOW = 300;
let lastClosedAt = 0;
/** Radix closes other tooltips only from a mounted box, and a waiting one has none yet. */
let closeOpenTooltip: (() => void) | null = null;

/**
 * The one plain tooltip box for the sidebar, the title bar and the workspace lists. Compact layouts
 * get none: touch has no hover.
 */
export function SidebarTooltip({
  content,
  shortcut,
  place = "sidebar",
  children,
}: {
  /** Nothing to say means no tooltip, as for a workspace without a folder. */
  content: ReactNode;
  /** Shown as key chips after the content, as this person has the command bound. */
  shortcut?: CommandId;
  place?: TooltipPlace;
  children: ReactElement;
}) {
  const compact = useContext(CompactLayoutContext);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [offsets, setOffsets] = useState(NEXT_TO_TRIGGER);
  // An open tooltip is the topmost dismissable layer, so it would take the Escape meant for the
  // menu or dialog around it. Removing it first, and without an exit animation that would keep the
  // layer mounted, lets one press close what the person is looking at.
  useEffect(() => {
    if (!open) return;
    closeOpenTooltip?.();
    const closeThis = () => setOpen(false);
    closeOpenTooltip = closeThis;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") flushSync(() => setOpen(false));
    };
    window.addEventListener("keydown", close, { capture: true });
    return () => {
      if (closeOpenTooltip === closeThis) closeOpenTooltip = null;
      window.removeEventListener("keydown", close, { capture: true });
    };
  }, [open]);
  if (compact || !content) return children;
  return (
    <Tooltip
      // The box below counts the delay: the provider's delay state goes stale when a tooltip closes
      // on Escape here, making the next one skip its wait.
      delayDuration={0}
      disableHoverableContent
      open={open}
      onOpenChange={(next) => {
        if (next && place === "sidebar") setOffsets(besideSidebar(trigger.current));
        setOpen(next);
      }}
    >
      <TooltipTrigger asChild ref={trigger}>
        {children}
      </TooltipTrigger>
      {open && (
        <TooltipBox place={place} offsets={offsets} shortcut={shortcut}>
          {content}
        </TooltipBox>
      )}
    </Tooltip>
  );
}

function TooltipBox({
  place,
  offsets,
  shortcut,
  children,
}: {
  place: TooltipPlace;
  offsets: { side: number; align: number };
  shortcut: CommandId | undefined;
  children: ReactNode;
}) {
  const [ready, setReady] = useState(() => Date.now() - lastClosedAt < SWEEP_WINDOW);
  useEffect(() => {
    if (ready) {
      return () => {
        lastClosedAt = Date.now();
      };
    }
    const timer = setTimeout(() => setReady(true), place === "menu" ? MENU_DELAY : HOVER_DELAY);
    return () => clearTimeout(timer);
  }, [place, ready]);
  if (!ready) return null;
  return (
    <TooltipContent
      arrow={false}
      collisionPadding={8}
      className="max-w-[320px] bg-popover/60 shadow-none backdrop-blur-md"
      {...(place === "title-bar"
        ? { side: "bottom", sideOffset: 6 }
        : { side: "right", align: "start", sideOffset: offsets.side, alignOffset: offsets.align })}
    >
      <div className="min-w-0 break-words">{children}</div>
      {shortcut && <BoundKeyChips id={shortcut} />}
    </TooltipContent>
  );
}

const NEXT_TO_TRIGGER = { side: 4, align: 0 };

/**
 * The offsets that carry a tooltip from its trigger, which may be only a row's name, to just past
 * the sidebar and level with the row.
 */
function besideSidebar(trigger: HTMLElement | null): { side: number; align: number } {
  const sidebar = trigger?.closest(".sidebar-shell");
  if (!trigger || !sidebar) return NEXT_TO_TRIGGER;
  const edge =
    sidebar.parentElement?.querySelector(".workspace-surface")?.getBoundingClientRect().left ??
    sidebar.getBoundingClientRect().right;
  const box = trigger.getBoundingClientRect();
  const row = trigger.closest("li") ?? trigger;
  return { side: edge - box.right + 4, align: row.getBoundingClientRect().top - box.top };
}
