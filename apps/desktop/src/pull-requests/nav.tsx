import { GitPullRequest } from "lucide-react";
import { cn } from "cn";
import type { WorkspaceSnapshot } from "@concors/protocol";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { totalOpenCount } from "./store";
import { usePullRequests } from "./use-pull-requests";

export function PullRequestsNav({
  workspace,
  selected,
  compact = false,
  onClick,
}: {
  workspace: WorkspaceSnapshot | null;
  selected: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  const { workspaces } = usePullRequests(workspace);
  const count = totalOpenCount(workspaces.values());
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label="Pull requests"
          aria-current={selected ? "page" : undefined}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-2 text-ui hover:bg-sidebar-accent",
            selected ? "bg-sidebar-accent text-sidebar-foreground" : "text-muted-foreground",
            compact && "sidebar-rail-control justify-center px-0",
          )}
        >
          <GitPullRequest className="size-4 shrink-0" aria-hidden="true" />
          {!compact && (
            <>
              <span className="flex-1 text-left">Pull requests</span>
              {count > 0 && <span className="text-xs tabular-nums">{count}</span>}
            </>
          )}
        </button>
      </TooltipTrigger>
      {compact && <TooltipContent side="right">Pull requests</TooltipContent>}
    </Tooltip>
  );
}
