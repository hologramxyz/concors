import { useState, type ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TextKeyChips } from "@/shortcuts/key-chips";

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
  side = "top",
  children,
}: {
  text: string;
  shortcut?: string | undefined;
  hidden?: boolean;
  /** Above, for the composer's controls; below for one with other controls above it. */
  side?: "top" | "bottom";
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip delayDuration={250} open={open && !hidden} onOpenChange={setOpen}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={6}>
        <span className="min-w-0 break-words">{text}</span>
        {shortcut && <TextKeyChips text={shortcut} />}
      </TooltipContent>
    </Tooltip>
  );
}
