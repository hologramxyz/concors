import type { ComponentProps } from "react";
import { Tooltip } from "@/components/ui/tooltip";

/** Expanded sidebar labels should not be covered by hover or focus tooltips. */
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
