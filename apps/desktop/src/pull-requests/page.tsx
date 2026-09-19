import { useContext, useState, type ReactNode } from "react";
import {
  ChevronDown,
  CircleCheck,
  CircleDot,
  CircleX,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  RefreshCw,
  X,
} from "lucide-react";
import { cn } from "cn";
import {
  PULL_REQUESTS_CAPABILITY,
  PULL_REQUEST_STATES_CAPABILITY,
  type PullRequest,
  type PullRequestRepository,
  type PullRequestState,
  type WorkspaceSnapshot,
} from "@concors/protocol";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { ProjectImage } from "@/workspace/project-image";
import { projectIconKey } from "@/workspace/project-icons";
import { useProjectIcons } from "@/workspace/use-project-icons";
import { PullRequestView } from "./detail";
import {
  ageLabel,
  byOpenCount,
  checksLabel,
  foldersLabel,
  repositoryLabel,
  reviewLabel,
} from "./labels";
import {
  invalidatePullRequests,
  pullRequestKey,
  totalOpenCount,
  workspaceOpenCount,
} from "./store";
import { QuickAction } from "./quick-action";
import { usePullRequests } from "./use-pull-requests";
import type { PullRequestTarget, PullRequestsView } from "./view";

const states = [
  {
    state: "open",
    label: "Open",
    Icon: GitPullRequest,
    tone: "text-emerald-600 dark:text-emerald-500",
  },
  {
    state: "merged",
    label: "Merged",
    Icon: GitMerge,
    tone: "text-violet-600 dark:text-violet-400",
  },
  { state: "closed", label: "Closed", Icon: GitPullRequestClosed, tone: "text-destructive" },
] as const;

/**
 * Pull requests in the GitHub repositories of every workspace, or of one workspace or repository,
 * grouped by workspace then repository: open ones by default, merged or closed on request. Open
 * rows can be merged or closed in place; opening one shows its details. The machine's own GitHub
 * sign-in is used, so a signed-out machine explains how to sign in instead of listing anything.
 */
export function PullRequestsPage({
  workspace,
  connected,
  view,
  onNavigate,
}: {
  workspace: WorkspaceSnapshot | null;
  connected: boolean;
  view: PullRequestsView;
  onNavigate: (view: PullRequestsView) => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const open = usePullRequests(workspace);
  const state = usePullRequests(workspace, view.state);
  const icons = useProjectIcons(workspace);
  const [mine, setMine] = useState(false);
  const [quick, setQuick] = useState<{
    target: PullRequestTarget;
    action: "merge" | "close";
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const capabilities =
    connection?.state.status === "ready" ? connection.state.daemon.capabilities : undefined;
  const supported =
    !!capabilities?.includes(PULL_REQUESTS_CAPABILITY) &&
    (view.state === "open" || capabilities.includes(PULL_REQUEST_STATES_CAPABILITY));
  const changed = () => {
    if (connection) invalidatePullRequests(connection);
    open.refresh();
    if (view.state !== "open") state.refresh();
  };
  const listings = (workspace?.projects ?? []).flatMap((project) => {
    const listing = state.workspaces.get(pullRequestKey(workspace?.epoch ?? "", project));
    return listing?.repositories.length ? [{ project, listing }] : [];
  });
  // A filter for a workspace that has since closed falls back to every workspace.
  const filtered = workspace?.projects.find((project) => project.id === view.projectId);
  const repository = filtered ? view.repository : null;
  const shown = (filtered ? listings.filter((item) => item.project === filtered) : listings).map(
    ({ project, listing }) => ({
      project,
      listing,
      repositories: byOpenCount(listing.repositories).filter(
        (item) => !repository || item.name.toLowerCase() === repository.toLowerCase(),
      ),
    }),
  );
  const filter = (projectId: string | null, repository: string | null = null) =>
    onNavigate({ ...view, projectId, repository, pullRequest: null });
  if (view.pullRequest)
    return (
      <PullRequestView
        key={JSON.stringify(view.pullRequest)}
        workspace={workspace}
        target={view.pullRequest}
        onBack={() => onNavigate({ ...view, pullRequest: null })}
        onChanged={changed}
      />
    );
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
            Pull requests in your workspaces&rsquo; GitHub repositories.
          </p>
        </div>
        {listed && (
          <Button variant="outline" onClick={state.refresh} disabled={state.refreshing}>
            <RefreshCw className={cn("size-4", state.refreshing && "animate-spin")} />
            Refresh
          </Button>
        )}
      </div>
      {connected && capabilities?.includes(PULL_REQUESTS_CAPABILITY) && (
        <div
          role="tablist"
          aria-label="Pull request state"
          className="mt-5 inline-flex self-start rounded-lg border bg-muted/40 p-0.5"
        >
          {states.map(({ state: option, label, Icon, tone }) => {
            const count =
              option === "open"
                ? open.status === "listed"
                  ? totalOpenCount(open.workspaces.values())
                  : null
                : option === view.state && listed
                  ? total
                  : null;
            return (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={view.state === option}
                onClick={() => {
                  setNotice(null);
                  onNavigate({ ...view, state: option, pullRequest: null });
                }}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-ui",
                  view.state === option
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className={cn("size-3.5", tone)} aria-hidden="true" />
                {label}
                {count !== null && <span className="text-xs tabular-nums opacity-70">{count}</span>}
              </button>
            );
          })}
        </div>
      )}
      {listed && (listings.length > 0 || filtered) && (
        <div
          role="toolbar"
          aria-label="Filter pull requests"
          className="-mx-4 mt-3 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
        >
          <FilterChip pressed={!filtered} onClick={() => filter(null)} count={total}>
            All workspaces
          </FilterChip>
          {listings.map(({ project, listing }) => {
            const icon = icons.get(projectIconKey(workspace?.epoch ?? "", project));
            return (
              <FilterChip
                key={project.id}
                pressed={filtered === project && !repository}
                onClick={() => filter(project.id)}
                count={workspaceOpenCount(listing)}
                icon={
                  <ProjectImage
                    key={icon?.source ?? "fallback"}
                    source={icon?.source ?? null}
                    isGit={icon?.isGit ?? false}
                    name={project.name}
                    size={16}
                  />
                }
              >
                {project.name}
              </FilterChip>
            );
          })}
          {filtered && repository && (
            <button
              type="button"
              aria-label={`Show every repository in ${filtered.name}`}
              onClick={() => filter(filtered.id)}
              className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-foreground/20 bg-muted px-2.5 text-ui"
            >
              {repositoryLabel(
                repository,
                listings.flatMap((item) => item.listing.repositories.map((entry) => entry.name)),
              )}
              <X className="size-3.5 text-muted-foreground" aria-hidden="true" />
            </button>
          )}
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
      {notice && (
        <p role="status" className="mt-4 text-ui text-muted-foreground">
          {notice}
        </p>
      )}
      {listed && state.message && (
        <p role="status" className="mt-4 text-ui text-muted-foreground">
          Showing the last loaded pull requests. {state.message}
        </p>
      )}
      {!connected ? (
        <Status>Connect to a machine to see its pull requests.</Status>
      ) : !supported ? (
        <Status>
          {view.state === "open"
            ? "Update the daemon on this machine to see pull requests."
            : `Update the daemon on this machine to see ${view.state} pull requests.`}
        </Status>
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
      ) : !shown.some((item) => item.repositories.length) ? (
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
          {shown.map(({ project, listing, repositories }) => {
            const icon = icons.get(projectIconKey(workspace?.epoch ?? "", project));
            return (
              <section key={project.id} aria-label={project.name}>
                {
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
                }
                <div className="space-y-3">
                  {repositories.map((item) => (
                    <Repository
                      key={item.name}
                      repository={item}
                      state={view.state}
                      pullRequests={visible(item)}
                      mine={mine}
                      onOpen={(number) =>
                        onNavigate({
                          ...view,
                          pullRequest: { projectId: project.id, repository: item.name, number },
                        })
                      }
                      onAction={(number, action) => {
                        setNotice(null);
                        setQuick({
                          target: { projectId: project.id, repository: item.name, number },
                          action,
                        });
                      }}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {quick && (
        <QuickAction
          key={JSON.stringify(quick)}
          workspace={workspace}
          target={quick.target}
          action={quick.action}
          onFinish={(result) => {
            setQuick(null);
            if (!result) return;
            setNotice(result);
            changed();
          }}
        />
      )}
    </div>
  );
}

function Repository({
  repository,
  state,
  pullRequests,
  mine,
  onOpen,
  onAction,
}: {
  repository: PullRequestRepository;
  state: PullRequestState;
  pullRequests: PullRequest[];
  mine: boolean;
  onOpen: (number: number) => void;
  onAction: (number: number, action: "merge" | "close") => void;
}) {
  const folders = foldersLabel(repository);
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
        <h4 className="min-w-0 truncate font-medium">{repository.name}</h4>
        {folders && (
          <span className="min-w-0 truncate text-xs text-muted-foreground">in {folders}</span>
        )}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
          {repository.error
            ? "Unavailable"
            : mine && repository.openCount && !pullRequests.length
              ? "None opened by you"
              : `${repository.openCount} ${state}`}
        </span>
      </header>
      {/* A repository with nothing to list stays a one-line header. */}
      {repository.error ? (
        <p className="px-4 py-3 text-muted-foreground">{repository.error}</p>
      ) : (
        pullRequests.length > 0 && (
          <ul className="divide-y">
            {pullRequests.map((pullRequest) => (
              <PullRequestRow
                key={pullRequest.number}
                pullRequest={pullRequest}
                permission={repository.permission}
                onOpen={() => onOpen(pullRequest.number)}
                onAction={(action) => onAction(pullRequest.number, action)}
              />
            ))}
          </ul>
        )
      )}
      {!repository.error && repository.openCount > repository.pullRequests.length && (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          Showing the {repository.pullRequests.length} most recently updated of{" "}
          {repository.openCount} {state}.
        </p>
      )}
    </article>
  );
}

const rowState = {
  open: [GitPullRequest, "text-emerald-600 dark:text-emerald-500"],
  draft: [GitPullRequestDraft, "text-muted-foreground"],
  merged: [GitMerge, "text-violet-600 dark:text-violet-400"],
  closed: [GitPullRequestClosed, "text-destructive"],
} as const;

function PullRequestRow({
  pullRequest,
  permission,
  onOpen,
  onAction,
}: {
  pullRequest: PullRequest;
  permission: PullRequestRepository["permission"];
  onOpen: () => void;
  onAction: (action: "merge" | "close") => void;
}) {
  const state = pullRequest.state ?? "open";
  const [Icon, tone] = rowState[state === "open" && pullRequest.draft ? "draft" : state];
  return (
    <li className="flex items-start gap-2 pr-3 hover:bg-muted/50 has-[>button:focus-visible]:bg-muted/50">
      <button
        type="button"
        onClick={onOpen}
        data-pull-request={pullRequest.number}
        data-pull-request-state={state}
        className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 text-left focus-visible:outline-none"
      >
        <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{pullRequest.title}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            #{pullRequest.number}
            {pullRequest.author ? ` · ${pullRequest.author}` : ""} · {pullRequest.branch} ·{" "}
            {ageLabel(pullRequest.updatedAt)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
          {pullRequest.draft && state === "open" && (
            <span className="rounded-md border px-1.5 py-0.5 max-sm:hidden">Draft</span>
          )}
          {pullRequest.review && state === "open" && (
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
      </button>
      {state === "open" && (
        <RowActions
          pullRequest={pullRequest}
          permission={permission}
          onOpen={onOpen}
          onAction={onAction}
        />
      )}
    </li>
  );
}

/**
 * Merge, with Close and details behind its menu, without opening the pull request. Only what the
 * machine's GitHub account may do is offered; an older daemon that does not report access leaves
 * the decision to GitHub.
 */
function RowActions({
  pullRequest,
  permission,
  onOpen,
  onAction,
}: {
  pullRequest: PullRequest;
  permission: PullRequestRepository["permission"];
  onOpen: () => void;
  onAction: (action: "merge" | "close") => void;
}) {
  const known = permission !== undefined && permission !== null;
  const canMerge = !known || ["admin", "maintain", "write"].includes(permission);
  const canClose = canMerge || permission === "triage" || pullRequest.mine;
  if (!canMerge && !canClose) return null;
  if (!canMerge)
    return (
      <Button
        variant="outline"
        className="mt-2.5 shrink-0"
        aria-label={`Close #${pullRequest.number}`}
        onClick={() => onAction("close")}
      >
        <GitPullRequestClosed />
        <span className="max-sm:sr-only">Close</span>
      </Button>
    );
  return (
    <div className="mt-2.5 flex shrink-0">
      <Button
        variant="outline"
        className="rounded-r-none"
        disabled={pullRequest.draft}
        title={pullRequest.draft ? "Drafts can't be merged" : undefined}
        aria-label={`Merge #${pullRequest.number}`}
        onClick={() => onAction("merge")}
      >
        <GitMerge />
        <span className="max-sm:sr-only">Merge</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="-ml-px rounded-l-none"
            aria-label={`More actions for #${pullRequest.number}`}
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={onOpen}>
            <GitPullRequest /> View details
          </DropdownMenuItem>
          {canClose && (
            <DropdownMenuItem variant="destructive" onSelect={() => onAction("close")}>
              <GitPullRequestClosed /> Close pull request…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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
  icon,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  count?: number;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "flex h-7 max-w-56 shrink-0 items-center gap-1.5 rounded-md border text-ui",
        icon ? "pr-2.5 pl-1.5" : "px-2.5",
        pressed
          ? "border-foreground/20 bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {icon}
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
