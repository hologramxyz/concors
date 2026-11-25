import { Webhook } from "lucide-react";
import { useContext } from "react";
import { WEBHOOK_TRIGGERS_CAPABILITY } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { cn } from "cn";

export function WebhooksNav({ selected, onClick }: { selected: boolean; onClick: () => void }) {
  const connection = useContext(TerminalConnectionContext);
  if (
    connection?.state.status !== "ready" ||
    !connection.state.daemon.capabilities?.includes(WEBHOOK_TRIGGERS_CAPABILITY)
  )
    return null;
  return (
    <button
      type="button"
      aria-label="Webhooks"
      aria-current={selected ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-ui hover:bg-sidebar-accent/70",
        selected ? "bg-sidebar-accent text-sidebar-foreground" : "text-muted-foreground",
      )}
    >
      <Webhook className="size-4 shrink-0" aria-hidden="true" />
      <span>Webhooks</span>
    </button>
  );
}
