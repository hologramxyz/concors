import * as React from "react";
import { cn } from "cn";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";
import { CompactLayoutContext } from "@/components/compact-layout";

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  size = "default",
  showCloseButton = true,
  closeLabel = "Close",
  headerActions,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** `media` grows with what it shows (an image at its own size) up to the window's edges. */
  size?: "default" | "wide" | "media";
  showCloseButton?: boolean;
  closeLabel?: string;
  headerActions?: React.ReactNode;
}) {
  const compact = React.useContext(CompactLayoutContext);
  const returnFocus = React.useRef<HTMLElement | null>(null);
  return (
    <DialogPortal>
      <DialogOverlay className={compact ? "mobile-drawer-overlay" : undefined} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-size={size}
        data-mobile-drawer={compact || undefined}
        onOpenAutoFocus={(event) => {
          returnFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          onOpenAutoFocus?.(event);
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (!compact || event.defaultPrevented) return;
          event.preventDefault();
          requestAnimationFrame(() => {
            const previous = returnFocus.current;
            const target =
              previous?.isConnected && !previous.closest("[inert]")
                ? previous
                : (document.querySelector<HTMLElement>(
                    "#mobile-sidebar:not([inert]) .mobile-account-trigger",
                  ) ?? document.getElementById("mobile-sidebar-toggle"));
            const nextDialog = document.querySelector(
              '[data-slot="dialog-content"][data-state="open"]',
            );
            if (!nextDialog || (target && nextDialog.contains(target))) target?.focus();
          });
        }}
        className={cn(
          "chat-scroll fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] min-w-0 -translate-x-1/2 -translate-y-1/2 flex-col gap-5 overflow-y-auto overscroll-contain rounded-xl bg-popover p-6 text-[15px] text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none motion-reduce:animate-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          size === "media"
            ? // Centred by its margins: a fit-content box placed at left: 50% could only grow
              // into the right half of the window.
              "inset-x-0 mx-auto w-fit max-w-[calc(100vw-2rem)] min-w-[min(28rem,calc(100vw-2rem))] translate-x-0"
            : size === "wide"
              ? "max-w-3xl"
              : "max-w-xl",
          className,
        )}
        {...props}
      >
        {compact && <div className="mobile-drawer-handle" aria-hidden="true" />}
        {children}
        {(showCloseButton || headerActions) && (
          <div
            data-slot="dialog-actions"
            className="absolute top-3 right-3 flex items-center gap-1"
          >
            {headerActions}
            {showCloseButton && (
              <DialogPrimitive.Close data-slot="dialog-close" asChild>
                <Button variant="ghost" size="icon">
                  <XIcon className="size-4.5" />
                  <span className="sr-only">{closeLabel}</span>
                </Button>
              </DialogPrimitive.Close>
            )}
          </div>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex min-w-0 shrink-0 flex-col gap-2 pr-8", className)}
      {...props}
    />
  );
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("chat-scroll min-h-0 min-w-0 overflow-y-auto overscroll-contain", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-6 -mb-6 flex shrink-0 flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-6 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading text-base leading-snug font-medium break-words", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-[15px] leading-relaxed text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
