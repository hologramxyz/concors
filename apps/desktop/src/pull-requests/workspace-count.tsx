import { useContext, useState } from "react";
import { cn } from "cn";
import { ArrowRight, ArrowUpRight, GitPullRequest } from "lucide-react";
import type { WorkspacePullRequests, WorkspaceProject } from "@concors/protocol";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { CompactLayoutContext } from "@/components/compact-layout";
import { openExternal } from "@/tauri";
import { byOpenCount, pullRequestsLabel, repositoryLabel } from "./labels";
import { workspaceOpenCount } from "./store";

/**
 * A workspace's open pull request count, at the end of its sidebar row. Hovering shows each
 * repository's share; clicking (or tapping, where there is no hover) opens the Pull requests page
 * for that workspace. Nothing is shown when the workspace has none.
 */
export function WorkspacePullRequestCount({
  project,
  listing,
  onOpen,
}: {
  project: WorkspaceProject;
  listing: WorkspacePullRequests | undefined;
  onOpen: (projectId: string) => void;
}) {
  const mobile = useContext(CompactLayoutContext);
  const [open, setOpen] = useState(false);
  const count = workspaceOpenCount(listing);
  if (!listing || !count) return null;
  const trigger = (
    <button
      type="button"
      data-pull-request-count={count}
      aria-label={`${pullRequestsLabel(count)} in ${project.name}`}
      onClick={() => {
        setOpen(false);
        onOpen(project.id);
      }}
      className="flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground tabular-nums hover:text-sidebar-foreground data-[state=open]:text-sidebar-foreground"
    >
      <GitPullRequest className="size-3.5" aria-hidden="true" />
      {count}
    </button>
  );
  if (mobile) return trigger;
  const repositories = byOpenCount(listing.repositories);
  const names = repositories.map((repository) => repository.name);
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
      <HoverCardContent side="right" align="start" sideOffset={10} className="w-72">
        <p className="truncate px-2 pt-1.5 pb-1 text-xs text-muted-foreground">
          {project.name} · {pullRequestsLabel(count)}
        </p>
        <ul aria-label={`Pull requests by repository in ${project.name}`}>
          {repositories.map((repository) => (
            <li key={repository.name}>
              <a
                href={`${repository.url}/pulls`}
                onClick={(event) => {
                  event.preventDefault();
                  void openExternal(`${repository.url}/pulls`);
                }}
                title={repository.error ?? `Open ${repository.name} pull requests on GitHub`}
                className={cn(
                  "group/repository flex h-8 items-center gap-2 rounded-md px-2 text-ui hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                  !repository.openCount && "text-muted-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  {repositoryLabel(repository.name, names)}
                </span>
                <ArrowUpRight
                  className="size-3.5 text-muted-foreground opacity-0 group-hover/repository:opacity-100 group-focus-visible/repository:opacity-100"
                  aria-hidden="true"
                />
                <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">
                  {repository.error ? "–" : repository.openCount}
                </span>
              </a>
            </li>
          ))}
        </ul>
        <div className="-mx-1 my-1 h-px bg-border" />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onOpen(project.id);
          }}
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-ui hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
        >
          <span className="flex-1">View all</span>
          <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </button>
      </HoverCardContent>
    </HoverCard>
  );
}
