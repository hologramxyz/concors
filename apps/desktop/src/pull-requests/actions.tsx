import { useState } from "react";
import type { MergeMethod, PullRequestDetail } from "@concors/protocol";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "cn";
import { mergeMethodLabel, mergeReadiness } from "./labels";

const methodDescription = (method: MergeMethod, base: string) =>
  method === "squash"
    ? `Combine every commit into one on ${base}.`
    : method === "merge"
      ? `Keep every commit, joined to ${base} by a merge commit.`
      : `Replay each commit onto ${base} without a merge commit.`;

/**
 * Confirms a merge and its method. The merge carries the head shown here, so commits pushed
 * after opening the dialog make GitHub refuse rather than merge unseen work. Opened from a list
 * row, it waits for the pull request's details before offering the merge.
 */
export function MergeDialog({
  number,
  detail,
  loadError = null,
  open,
  onOpenChange,
  onMerge,
}: {
  number: number;
  detail: PullRequestDetail | null;
  loadError?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerge: (method: MergeMethod, expectedHeadSha: string) => Promise<void>;
}) {
  const [method, setMethod] = useState<MergeMethod | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = method ?? detail?.defaultMergeMethod ?? detail?.mergeMethods[0] ?? "merge";
  const readiness = detail ? mergeReadiness(detail) : null;
  const closed = detail && detail.state !== "open";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Merge pull request #{number}?</DialogTitle>
          <DialogDescription>
            {detail
              ? `${detail.title} · ${detail.headBranch} into ${detail.baseBranch}`
              : "Checking the pull request…"}
          </DialogDescription>
        </DialogHeader>
        {!detail ? (
          <p role={loadError ? "alert" : "status"} className="text-ui text-muted-foreground">
            {loadError ?? "Loading merge options…"}
          </p>
        ) : closed ? (
          <p role="status" className="text-ui text-muted-foreground">
            This pull request is already {detail.state}.
          </p>
        ) : (
          <div role="radiogroup" aria-label="Merge method" className="space-y-1.5">
            {detail.mergeMethods.map((option) => (
              <label
                key={option}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-ui",
                  chosen === option ? "border-foreground/30 bg-muted/60" : "hover:bg-muted/40",
                )}
              >
                <input
                  type="radio"
                  name="merge-method"
                  className="mt-1 accent-foreground"
                  checked={chosen === option}
                  disabled={pending}
                  onChange={() => setMethod(option)}
                />
                <span>
                  <span className="block font-medium">{mergeMethodLabel[option]}</span>
                  <span className="block text-muted-foreground">
                    {methodDescription(option, detail.baseBranch)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
        {detail && !closed && readiness && readiness.tone !== "ready" && (
          <p
            className={cn(
              "text-ui",
              readiness.tone === "blocked" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {readiness.title}. {readiness.description}
          </p>
        )}
        {error && (
          <p role="alert" className="text-ui text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || !detail || !!closed || !readiness?.allowed}
            onClick={() => {
              if (!detail) return;
              setPending(true);
              setError(null);
              onMerge(chosen, detail.headSha)
                .then(() => onOpenChange(false))
                .catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : "Could not merge."),
                )
                .finally(() => setPending(false));
            }}
          >
            {pending ? "Merging…" : mergeMethodLabel[chosen]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Confirms closing, optionally posting a comment first, like GitHub's Close with comment. */
export function CloseDialog({
  number,
  open,
  initialComment,
  onOpenChange,
  onClose,
}: {
  number: number;
  open: boolean;
  initialComment: string;
  onOpenChange: (open: boolean) => void;
  onClose: (comment: string) => Promise<void>;
}) {
  const [comment, setComment] = useState(initialComment);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Close pull request #{number}?</DialogTitle>
          <DialogDescription>
            It is closed without merging. It stays on GitHub and can be reopened there.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="Closing comment"
          placeholder="Leave a comment (optional)"
          value={comment}
          disabled={pending}
          onChange={(event) => setComment(event.target.value)}
          className="min-h-24"
        />
        {error && (
          <p role="alert" className="text-ui text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => {
              setPending(true);
              setError(null);
              onClose(comment.trim())
                .then(() => onOpenChange(false))
                .catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : "Could not close."),
                )
                .finally(() => setPending(false));
            }}
          >
            {pending ? "Closing…" : comment.trim() ? "Comment and close" : "Close pull request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
