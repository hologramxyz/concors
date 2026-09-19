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
 * after opening the dialog make GitHub refuse rather than merge unseen work.
 */
export function MergeDialog({
  detail,
  open,
  onOpenChange,
  onMerge,
}: {
  detail: PullRequestDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerge: (method: MergeMethod, expectedHeadSha: string) => Promise<void>;
}) {
  const [method, setMethod] = useState<MergeMethod | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = method ?? detail.defaultMergeMethod ?? detail.mergeMethods[0] ?? "merge";
  const readiness = mergeReadiness(detail);
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
          <DialogTitle>Merge pull request #{detail.number}?</DialogTitle>
          <DialogDescription>
            {detail.repository}: {detail.headBranch} into {detail.baseBranch}.
          </DialogDescription>
        </DialogHeader>
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
        {readiness.tone === "warning" && (
          <p className="text-ui text-muted-foreground">
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
            disabled={pending || !readiness.allowed}
            onClick={() => {
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
  detail,
  open,
  initialComment,
  onOpenChange,
  onClose,
}: {
  detail: PullRequestDetail;
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
          <DialogTitle>Close pull request #{detail.number}?</DialogTitle>
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
