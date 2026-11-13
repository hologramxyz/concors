import { Network } from "lucide-react";
import { cn } from "cn";

export function SupervisorNav({ selected, onClick }: { selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Supervisor"
      aria-current={selected ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-ui hover:bg-sidebar-accent/70",
        selected
          ? "bg-sidebar-accent text-sidebar-foreground hover:bg-sidebar-accent"
          : "text-muted-foreground",
      )}
    >
      <Network className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1 text-left">Supervisor</span>
    </button>
  );
}
