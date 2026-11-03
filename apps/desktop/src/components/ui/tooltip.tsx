import * as React from "react";
import { cn } from "cn";
import { Tooltip as TooltipPrimitive } from "radix-ui";

/**
 * Whether Tab is down, the only key that moves focus to a control on purpose. Menus and dialogs
 * hand focus back when they close, on a click or a key alike, and that is no reason to explain the
 * control. It is cleared on release, so focus moved later by the app does not count either.
 */
let tabbing = false;
if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    (event) => {
      tabbing = event.key === "Tab";
    },
    true,
  );
  window.addEventListener("keyup", () => (tabbing = false), true);
  window.addEventListener("blur", () => (tabbing = false));
}

function TooltipProvider({
  delayDuration = 0,
  // A tooltip that waits for the pointer to reach it holds the next control's back until the
  // pointer has crossed the gap, so moving along a row kept showing the first one.
  disableHoverableContent = true,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      disableHoverableContent={disableHoverableContent}
      {...props}
    />
  );
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({
  onFocus,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onFocus={(event) => {
        onFocus?.(event);
        // Radix opens on any focus unless the event is marked as handled.
        if (!tabbing) event.preventDefault();
      }}
      {...props}
    />
  );
}

function TooltipContent({
  className,
  sideOffset = 0,
  arrow = true,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & { arrow?: boolean }) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 inline-flex w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
        {arrow && (
          <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-xs bg-popover fill-popover" />
        )}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
