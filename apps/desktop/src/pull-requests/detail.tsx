import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleX,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  LoaderCircle,
} from "lucide-react";
import { cn } from "cn";
import type {
  PullRequestCheck,
  PullRequestDetail,
  PullRequestTimelineEntry,
  WorkspaceSnapshot,
} from "@concors/protocol";
import { AgentMarkdown } from "@/agents/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { openExternal } from "@/tauri";
import { ProjectImage } from "@/workspace/project-image";
import { projectIconKey } from "@/workspace/project-icons";
import { useProjectIcons } from "@/workspace/use-project-icons";
import { CloseDialog, MergeDialog } from "./actions";
import { ageLabel, checksLabel, mergeReadiness, reviewLabel } from "./labels";
import { usePullRequest } from "./use-pull-request";
import type { PullRequestTarget } from "./view";

/**
 * One pull request, managed without leaving Concors: its state and merge readiness, checks,
 * description and conversation, with Merge, Close and Comment. GitHub is one explicit button.
 */
export function PullRequestView({
  workspace,
  target,
  onBack,
  onChanged,
}: {
  workspace: WorkspaceSnapshot | null;
  target: PullRequestTarget;
  onBack: () => void;
  /** A merge, close or comment changed what the list shows. */
  onChanged: () => void;
}) {
  const { project, detail, error, loading, reload, run } = usePullRequest(workspace, target);
  const icons = useProjectIcons(workspace);
  const [dialog, setDialog] = useState<"merge" | "close" | null>(null);
  const [comment, setComment] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const icon = project && workspace && icons.get(projectIconKey(workspace.epoch, project));
  const submitComment = () => {
    const body = comment.trim();
    if (!body || commenting) return;
    setCommenting(true);
    setActionError(null);
    run({ kind: "comment", body })
      .then(() => {
        setComment("");
        onChanged();
      })
      .catch((cause: unknown) =>
        setActionError(cause instanceof Error ? cause.message : "Could not comment."),
      )
      .finally(() => setCommenting(false));
  };
  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 py-6 sm:px-8 sm:py-8">
      <Button variant="ghost" onClick={onBack} className="-ml-2 self-start">
        <ArrowLeft />
        Pull requests
      </Button>
      {!detail ? (
        <div className="my-16 flex flex-col items-center gap-3 text-center text-ui">
          {error ? (
            <>
              <p role="alert" className="text-destructive">
                {error}
              </p>
              <Button variant="outline" disabled={loading} onClick={reload}>
                Try again
              </Button>
            </>
          ) : (
            <p role="status" className="text-muted-foreground">
              {project ? "Loading pull request…" : "This workspace is no longer open."}
            </p>
          )}
        </div>
      ) : (
        <article aria-label={`Pull request #${detail.number}`} className="mt-3 min-w-0">
          <header>
            <p className="flex min-w-0 items-center gap-2 text-ui text-muted-foreground">
              {project && (
                <ProjectImage
                  key={icon?.source ?? "fallback"}
                  source={icon?.source ?? null}
                  isGit={icon?.isGit ?? false}
                  name={project.name}
                  size={16}
                />
              )}
              <span className="min-w-0 truncate">
                {detail.repository} · #{detail.number}
              </span>
            </p>
            <h2 className="mt-1.5 text-xl font-semibold break-words">{detail.title}</h2>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-ui text-muted-foreground">
              <StateBadge detail={detail} />
              <span className="min-w-0 break-words">
                {detail.author ?? "Someone"} wants to merge {detail.commits} commit
                {detail.commits === 1 ? "" : "s"} into <Branch>{detail.baseBranch}</Branch> from{" "}
                <Branch>{detail.headBranch}</Branch>
              </span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
              <span className="text-emerald-600 dark:text-emerald-500">+{detail.additions}</span>{" "}
              <span className="text-destructive">−{detail.deletions}</span> · {detail.changedFiles}{" "}
              file{detail.changedFiles === 1 ? "" : "s"} · updated {ageLabel(detail.updatedAt)}
            </p>
            {detail.labels.length > 0 && (
              <ul aria-label="Labels" className="mt-2.5 flex flex-wrap gap-1.5">
                {detail.labels.map((label) => (
                  <li
                    key={label.name}
                    className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
                  >
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: `#${label.color}` }}
                      aria-hidden="true"
                    />
                    {label.name}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {detail.state === "open" && (
                <Button
                  disabled={!mergeReadiness(detail).allowed || !detail.mergeMethods.length}
                  onClick={() => setDialog("merge")}
                >
                  <GitMerge />
                  Merge…
                </Button>
              )}
              {detail.state === "open" && detail.canClose && (
                <Button variant="outline" onClick={() => setDialog("close")}>
                  <GitPullRequestClosed />
                  Close…
                </Button>
              )}
              <Button variant="ghost" onClick={() => void openExternal(detail.url)}>
                <ArrowUpRight />
                Open on GitHub
              </Button>
            </div>
          </header>
          {notice && (
            <p role="status" className="mt-4 text-ui text-muted-foreground">
              {notice}
            </p>
          )}
          {actionError && (
            <p role="alert" className="mt-4 text-ui text-destructive">
              {actionError}
            </p>
          )}
          {detail.state === "open" && <MergeStatus detail={detail} />}
          <section aria-label="Description" className="mt-6 rounded-lg border bg-background">
            <h3 className="border-b px-4 py-2.5 text-ui font-medium">
              {detail.author ?? "Someone"} opened this {ageLabel(detail.createdAt)}
            </h3>
            <div className="px-4 py-3 text-ui">
              {detail.body ? (
                <AgentMarkdown>{detail.body}</AgentMarkdown>
              ) : (
                <p className="text-muted-foreground">No description provided.</p>
              )}
              {detail.bodyTruncated && <Truncated />}
            </div>
          </section>
          <section aria-label="Conversation" className="mt-6">
            <h3 className="text-ui font-medium">
              Conversation
              {detail.commentCount > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                  {detail.commentCount} comment{detail.commentCount === 1 ? "" : "s"}
                </span>
              )}
            </h3>
            {detail.timeline.length ? (
              <ol className="mt-3 space-y-3">
                {detail.timeline.map((entry) => (
                  <TimelineEntry key={entry.id} entry={entry} />
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-ui text-muted-foreground">No comments yet.</p>
            )}
            <div className="mt-4 rounded-lg border bg-background p-3">
              <Textarea
                aria-label="Comment"
                placeholder="Leave a comment"
                value={comment}
                disabled={commenting}
                onChange={(event) => setComment(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    submitComment();
                  }
                }}
                className="min-h-20 border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
              />
              <div className="mt-2 flex justify-end">
                <Button disabled={!comment.trim() || commenting} onClick={submitComment}>
                  {commenting ? "Commenting…" : "Comment"}
                </Button>
              </div>
            </div>
          </section>
          <MergeDialog
            key={`merge-${detail.headSha}`}
            detail={detail}
            open={dialog === "merge"}
            onOpenChange={(open) => setDialog(open ? "merge" : null)}
            onMerge={async (method, expectedHeadSha) => {
              setActionError(null);
              await run({ kind: "merge", method, expectedHeadSha });
              setNotice(`Merged into ${detail.baseBranch}.`);
              onChanged();
            }}
          />
          <CloseDialog
            key={`close-${dialog === "close"}`}
            detail={detail}
            open={dialog === "close"}
            initialComment={comment}
            onOpenChange={(open) => setDialog(open ? "close" : null)}
            onClose={async (closing) => {
              setActionError(null);
              await run({ kind: "close", ...(closing ? { comment: closing } : {}) });
              setComment("");
              setNotice("Closed without merging.");
              onChanged();
            }}
          />
        </article>
      )}
    </div>
  );
}

function Branch({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
      {children}
    </code>
  );
}

function StateBadge({ detail }: { detail: PullRequestDetail }) {
  const [label, Icon, tone] =
    detail.state === "merged"
      ? (["Merged", GitMerge, "bg-violet-600 text-white"] as const)
      : detail.state === "closed"
        ? (["Closed", GitPullRequestClosed, "bg-destructive text-white"] as const)
        : detail.draft
          ? (["Draft", GitPullRequestDraft, "bg-muted-foreground/80 text-background"] as const)
          : (["Open", GitPullRequest, "bg-emerald-600 text-white"] as const);
  return (
    <span
      data-pull-request-state={detail.state}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        tone,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}

const checkIcon = {
  passing: [CircleCheck, "text-emerald-600 dark:text-emerald-500"],
  failing: [CircleX, "text-destructive"],
  pending: [CircleDot, "text-amber-500"],
  skipped: [CircleDot, "text-muted-foreground"],
} as const;

function MergeStatus({ detail }: { detail: PullRequestDetail }) {
  const readiness = mergeReadiness(detail);
  const [expanded, setExpanded] = useState(false);
  const Icon =
    readiness.tone === "ready"
      ? CircleCheck
      : readiness.tone === "pending"
        ? LoaderCircle
        : readiness.tone === "warning"
          ? CircleAlert
          : CircleX;
  const failing = detail.checks.filter((check) => check.state === "failing").length;
  const pending = detail.checks.filter((check) => check.state === "pending").length;
  return (
    <section
      aria-label="Merge status"
      className="mt-6 overflow-hidden rounded-lg border bg-background text-ui"
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <Icon
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-4 shrink-0",
            readiness.tone === "ready" && "text-emerald-600 dark:text-emerald-500",
            readiness.tone === "pending" && "animate-spin text-muted-foreground",
            readiness.tone === "warning" && "text-amber-500",
            readiness.tone === "blocked" && "text-destructive",
          )}
        />
        <div className="min-w-0">
          <p className="font-medium">{readiness.title}</p>
          <p className="text-muted-foreground">{readiness.description}</p>
          {detail.review && (
            <p className="mt-1 text-muted-foreground">{reviewLabel[detail.review]}</p>
          )}
        </div>
      </div>
      {detail.checks.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            className="flex w-full items-center gap-2 border-t px-4 py-2 text-left text-muted-foreground hover:bg-muted/40"
          >
            <span className="flex-1">
              {detail.checkCount} check{detail.checkCount === 1 ? "" : "s"}
              {failing ? ` · ${failing} failing` : ""}
              {pending ? ` · ${pending} running` : ""}
            </span>
            <span className="text-xs">{expanded ? "Hide" : "Show"}</span>
          </button>
          {expanded && (
            <ul className="divide-y border-t">
              {detail.checks.map((check, index) => (
                <CheckRow key={`${check.name}-${index}`} check={check} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function CheckRow({ check }: { check: PullRequestCheck }) {
  const [Icon, tone] = checkIcon[check.state];
  return (
    <li className="flex items-center gap-2.5 px-4 py-2">
      <Icon className={cn("size-4 shrink-0", tone)} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{check.name}</span>
      <span className="text-xs text-muted-foreground">
        {check.state === "skipped" ? "Skipped" : checksLabel[check.state].replace("Checks ", "")}
      </span>
    </li>
  );
}

const reviewTone = {
  approved: ["approved", "text-emerald-600 dark:text-emerald-500"],
  "changes-requested": ["requested changes", "text-destructive"],
  commented: ["reviewed", "text-muted-foreground"],
  dismissed: ["review was dismissed", "text-muted-foreground"],
} as const;

function TimelineEntry({ entry }: { entry: PullRequestTimelineEntry }) {
  const review = entry.review ? reviewTone[entry.review] : null;
  return (
    <li className="rounded-lg border bg-background text-ui">
      <p className="flex flex-wrap items-center gap-x-1.5 border-b bg-muted/30 px-4 py-2 text-muted-foreground">
        <span className="font-medium text-foreground">{entry.author ?? "Someone"}</span>
        {review ? <span className={review[1]}>{review[0]}</span> : <span>commented</span>}
        <span>· {ageLabel(entry.createdAt)}</span>
      </p>
      {entry.body && (
        <div className="px-4 py-3">
          <AgentMarkdown>{entry.body}</AgentMarkdown>
          {entry.truncated && <Truncated />}
        </div>
      )}
    </li>
  );
}

function Truncated() {
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      This is long, so only the beginning is shown. Open on GitHub has the rest.
    </p>
  );
}
