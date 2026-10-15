import { useState, type ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";

/**
 * Names a composer control on hover. Most of them are bare icons, and the webview's own `title`
 * tooltip waits a second or more before it appears, when it appears at all. `hidden` keeps it away
 * while the control's own menu is open, and after the menu closes until the pointer comes back to
 * the control, so picking an option does not bring the tooltip straight back as focus returns.
 */
export function ControlTooltip({
  text,
  shortcut,
  hidden = false,
  children,
}: {
  text: string;
  shortcut?: string | undefined;
  hidden?: boolean;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip delayDuration={250} open={open && !hidden} onOpenChange={setOpen}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        <span className="min-w-0 break-words">{text}</span>
        {shortcut && <Kbd className="shrink-0">{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}
