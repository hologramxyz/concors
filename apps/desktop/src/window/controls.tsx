import { Copy, Minus, Square, X } from "lucide-react";
import { useWindowChrome } from "./context";

export function WindowControls() {
  const { enabled, maximized, actions } = useWindowChrome();
  if (!enabled || !actions) return null;
  return (
    <div
      role="group"
      aria-label="Window controls"
      data-tauri-drag-region="false"
      className="ml-1 flex shrink-0 items-center border-l border-border pl-1 text-muted-foreground"
    >
      {[
        { label: "Minimize window", Icon: Minus, action: actions.minimize },
        {
          label: maximized ? "Restore window" : "Maximize window",
          Icon: maximized ? Copy : Square,
          action: actions.toggleMaximize,
        },
        { label: "Close window", Icon: X, action: actions.close },
      ].map(({ label, Icon, action }) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          title={label}
          onClick={() => void action().catch(console.error)}
          className={`flex h-7 w-8 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${label === "Close window" ? "hover:bg-red-600 hover:text-white" : "hover:bg-muted hover:text-foreground"}`}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/** The sign-in screen has no tabs to host controls. */
export function StandaloneWindowBar() {
  const { enabled } = useWindowChrome();
  if (!enabled) return null;
  return (
    <div
      data-tauri-drag-region
      className="fixed inset-x-2 top-2 z-40 flex h-9 items-center justify-end select-none"
    >
      <WindowControls />
    </div>
  );
}
