import type { ComponentProps } from "react";
import { Tooltip } from "@/components/ui/tooltip";

/** Utility controls use rail-only tooltips; project and agent rows use Tooltip directly. */
export function SidebarTooltip({
  collapsed,
  ...props
}: Omit<ComponentProps<typeof Tooltip>, "open" | "defaultOpen" | "onOpenChange"> & {
  collapsed: boolean;
}) {
  return (
    <Tooltip
      // Reset hover state between modes without switching a mounted root between
      // controlled (disabled) and uncontrolled (normal rail tooltip) behavior.
      key={collapsed ? "collapsed" : "expanded"}
      {...props}
      {...(collapsed ? {} : { open: false })}
    />
  );
}
