import type { ReactElement } from "react";
import { SidebarTooltip } from "@/components/sidebar-tooltip";

/**
 * The shared tooltip as a composer control uses it. Most of them are bare icons. `hidden` keeps it
 * away while the control's own menu is open, and after the menu closes until the pointer comes back
 * to the control.
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
  return (
    <SidebarTooltip
      content={text}
      keys={shortcut}
      hidden={hidden}
      place={side === "top" ? "above" : "title-bar"}
    >
      {children}
    </SidebarTooltip>
  );
}
