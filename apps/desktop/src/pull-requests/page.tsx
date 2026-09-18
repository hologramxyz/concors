import { useContext, useState, type MouseEvent, type ReactNode } from "react";
import {
  CircleCheck,
  CircleDot,
  CircleX,
  GitPullRequest,
  GitPullRequestDraft,
  RefreshCw,
} from "lucide-react";
import { cn } from "cn";
import {
  PULL_REQUESTS_CAPABILITY,
  type PullRequest,
  type PullRequestRepository,
  type WorkspaceSnapshot,
} from "@concors/protocol";
import { Button } from "@/components/ui/button";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { openExternal } from "@/tauri";
import { ProjectImage } from "@/workspace/project-image";
import { projectIconKey } from "@/workspace/project-icons";
import { useProjectIcons } from "@/workspace/use-project-icons";
import { ageLabel, byOpenCount, checksLabel, foldersLabel, reviewLabel } from "./labels";
import { pullRequestKey, totalOpenCount, workspaceOpenCount } from "./store";
import { usePullRequests } from "./use-pull-requests";

const open = (url: string) => (event: MouseEvent) => {
  event.preventDefault();
  void openExternal(url);
};

/**
 * Open pull requests in the GitHub repositories of every workspace, or of one. Grouped by
 * workspace, then repository; each row opens on GitHub. The machine's own GitHub sign-in is used,
 * so a signed-out machine explains how to sign in instead of listing anything.
 */
export function PullRequestsPage({
  workspace,
  connected,
  projectId,
  onFilter,
}: {
  workspace: WorkspaceSnapshot | null;
  connected: boolean;
  /** One workspace's pull requests, or every workspace's when null. */
  projectId: string | null;
  onFilter: (projectId: string | null) => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const state = usePullRequests(workspace);
  const icons = useProjectIcons(workspace);
  const [mine, setMine] = useState(false);
  const supported =
    connection?.state.status === "ready" &&
    !!connection.state.daemon.capabilities?.includes(PULL_REQUESTS_CAPABILITY);
  const listings = (workspace?.projects ?? []).flatMap((project) => {
    const listing = state.workspaces.get(pullRequestKey(workspace?.epoch ?? "", project));
    return listing?.repositories.length ? [{ project, listing }] : [];
  });
  // A filter for a workspace that has since closed falls back to every workspace.
  const filtered = workspace?.projects.find((project) => project.id === projectId);
  const shown = filtered ? listings.filter((item) => item.project === filtered) : listings;
  const total = totalOpenCount(listings.map((item) => item.listing));
  const visible = (repository: PullRequestRepository) =>
    mine
      ? repository.pullRequests.filter((pullRequest) => pullRequest.mine)
      : repository.pullRequests;
  const listed = connected && supported && state.status === "listed";
  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">Pull requests</h2>
          <p className="mt-1 text-ui text-muted-foreground">
            Open pull requests in your workspaces&rsquo; GitHub repositories.
          </p>
        </div>
        {listed && (
          <Button variant="outline" onClick={state.refresh} disabled={state.refreshing}>
            <RefreshCw className={cn("size-4", state.refreshing && "animate-spin")} />
            Refresh
          </Button>
        )}
      </div>
      {listed && (listings.length > 0 || filtered) && (
        <div
          role="toolbar"
          aria-label="Filter pull requests"
          className="-mx-4 mt-5 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
        >
          <FilterChip pressed={!filtered} onClick={() => onFilter(null)} count={total}>
            All workspaces
          </FilterChip>
          {listings.map(({ project, listing }) => (
            <FilterChip
              key={project.id}
              pressed={filtered === project}
              onClick={() => onFilter(project.id)}
              count={workspaceOpenCount(listing)}
            >
              {project.name}
            </FilterChip>
          ))}
          {state.viewer && (
            <>
              <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
              <FilterChip pressed={mine} onClick={() => setMine(!mine)}>
                Opened by you
              </FilterChip>
            </>
          )}
        </div>
      )}
      {listed && state.message && (
        <p role="status" className="mt-4 text-ui text-muted-foreground">
          Showing the last loaded pull requests. {state.message}
        </p>
      )}
      {!connected ? (
        <Status>Connect to a machine to see its pull requests.</Status>
      ) : !supported ? (
        <Status>Update the daemon on this machine to see pull requests.</Status>
      ) : state.status === "signed-out" ? (
        <Empty title="Sign in to GitHub on this machine">
          {state.message}
          <code className="mt-3 block rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground select-all">
            gh auth login
          </code>
        </Empty>
      ) : state.status === "error" ? (
        <Empty title="Could not load pull requests">
          {state.message}
          <Button className="mt-4" variant="outline" onClick={state.refresh}>
            Try again
          </Button>
        </Empty>
      ) : state.status !== "listed" ? (
        <Status>Loading pull requests…</Status>
      ) : !shown.length ? (
        <Empty
          title={
            filtered ? `No GitHub repositories in ${filtered.name}` : "No GitHub repositories yet"
          }
        >
          Open a folder that is a GitHub repository, or that contains repositories, to see its pull
          requests here.
        </Empty>
      ) : (
        <div className="mt-6 space-y-8">
          {shown.map(({ project, listing }) => {
            const icon = icons.get(projectIconKey(workspace?.epoch ?? "", project));
            return (
              <section key={project.id} aria-label={project.name}>
                {shown.length > 1 && (
                  <h3 className="mb-3 flex items-center gap-2 text-ui font-medium">
                    <ProjectImage
                      key={icon?.source ?? "fallback"}
                      source={icon?.source ?? null}
                      isGit={icon?.isGit ?? false}
                      name={project.name}
                    />
                    <span className="min-w-0 truncate">{project.name}</span>
                    <span className="text-xs font-normal text-muted-foreground tabular-nums">
                      {workspaceOpenCount(listing)}
                    </span>
                  </h3>
                )}
                <div className="space-y-3">
                  {byOpenCount(listing.repositories).map((repository) => (
                    <Repository
                      key={repository.name}
                      repository={repository}
                      pullRequests={visible(repository)}
                      mine={mine}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Repository({
  repository,
  pullRequests,
  mine,
}: {
  repository: PullRequestRepository;
  pullRequests: PullRequest[];
  mine: boolean;
}) {
  const folders = foldersLabel(repository);
  const pulls = `${repository.url}/pulls`;
  return (
    <article
      aria-label={repository.name}
      className="overflow-hidden rounded-lg border bg-background text-ui shadow-xs"
    >
      <header
        className={cn(
          "flex items-center gap-2 bg-muted/30 px-4 py-2.5",
          (repository.error || pullRequests.length > 0) && "border-b",
        )}
      >
        <a
          href={pulls}
          onClick={open(pulls)}
          className="min-w-0 truncate font-medium hover:underline"
        >
          {repository.name}
        </a>
        {folders && (
          <span className="min-w-0 truncate text-xs text-muted-foreground">in {folders}</span>
        )}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
          {repository.error
            ? "Unavailable"
            : mine && repository.openCount && !pullRequests.length
              ? "None opened by you"
              : `${repository.openCount} open`}
        </span>
      </header>
      {/* A repository with nothing to list stays a one-line header. */}
      {repository.error ? (
        <p className="px-4 py-3 text-muted-foreground">{repository.error}</p>
      ) : (
        pullRequests.length > 0 && (
          <ul className="divide-y">
            {pullRequests.map((pullRequest) => (
              <PullRequestRow key={pullRequest.number} pullRequest={pullRequest} />
            ))}
          </ul>
        )
      )}
      {!repository.error && repository.openCount > repository.pullRequests.length && (
        <a
          href={pulls}
          onClick={open(pulls)}
          className="block border-t px-4 py-2 text-xs text-muted-foreground hover:text-foreground"
        >
          View all {repository.openCount} on GitHub
        </a>
      )}
    </article>
  );
}

function PullRequestRow({ pullRequest }: { pullRequest: PullRequest }) {
  const Icon = pullRequest.draft ? GitPullRequestDraft : GitPullRequest;
  return (
    <li>
      <a
        href={pullRequest.url}
        onClick={open(pullRequest.url)}
        data-pull-request={pullRequest.number}
        className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
      >
        <Icon
          className={cn(
            "mt-0.5 size-4 shrink-0",
            pullRequest.draft ? "text-muted-foreground" : "text-emerald-600 dark:text-emerald-500",
          )}
          aria-label={pullRequest.draft ? "Draft" : "Open"}
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{pullRequest.title}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            #{pullRequest.number}
            {pullRequest.author ? ` · ${pullRequest.author}` : ""} · {pullRequest.branch} ·{" "}
            {ageLabel(pullRequest.updatedAt)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
          {pullRequest.draft && (
            <span className="rounded-md border px-1.5 py-0.5 max-sm:hidden">Draft</span>
          )}
          {pullRequest.review && (
            <span
              className={cn(
                "max-sm:hidden",
                pullRequest.review === "approved" && "text-emerald-600 dark:text-emerald-500",
                pullRequest.review === "changes-requested" && "text-destructive",
              )}
            >
              {reviewLabel[pullRequest.review]}
            </span>
          )}
          {pullRequest.checks && <Checks state={pullRequest.checks} />}
        </div>
      </a>
    </li>
  );
}

function Checks({ state }: { state: NonNullable<PullRequest["checks"]> }) {
  const Icon = state === "passing" ? CircleCheck : state === "failing" ? CircleX : CircleDot;
  return (
    <span role="img" aria-label={checksLabel[state]} title={checksLabel[state]}>
      <Icon
        aria-hidden="true"
        className={cn(
          "size-4",
          state === "passing" && "text-emerald-600 dark:text-emerald-500",
          state === "failing" && "text-destructive",
          state === "pending" && "text-amber-500",
        )}
      />
    </span>
  );
}

function FilterChip({
  pressed,
  onClick,
  count,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  count?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "flex h-7 max-w-56 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-ui",
        pressed
          ? "border-foreground/20 bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <span className="truncate">{children}</span>
      {count !== undefined && <span className="text-xs tabular-nums opacity-70">{count}</span>}
    </button>
  );
}

function Status({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="my-16 text-center text-ui text-muted-foreground">
      {children}
    </p>
  );
}

function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20 text-center">
      <div className="flex size-14 items-center justify-center rounded-xl border bg-muted/40">
        <GitPullRequest className="size-6 text-muted-foreground" />
      </div>
      <div className="flex max-w-sm flex-col items-center">
        <h3 className="text-lg font-medium">{title}</h3>
        <div className="mt-2 text-ui leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}
