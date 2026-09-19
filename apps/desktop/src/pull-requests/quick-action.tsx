import type { WorkspaceSnapshot } from "@concors/protocol";
import { CloseDialog, MergeDialog } from "./actions";
import { usePullRequest } from "./use-pull-request";
import type { PullRequestTarget } from "./view";

/**
 * Merge or close straight from a list row. The confirmation opens at once and reads the pull
 * request behind it, so the merge still carries the head and readiness GitHub will check.
 */
export function QuickAction({
  workspace,
  target,
  action,
  onFinish,
}: {
  workspace: WorkspaceSnapshot | null;
  target: PullRequestTarget;
  action: "merge" | "close";
  /** Called with what happened, or null when cancelled. */
  onFinish: (notice: string | null) => void;
}) {
  const { detail, error, run } = usePullRequest(workspace, target);
  const cancel = (open: boolean) => {
    if (!open) onFinish(null);
  };
  return action === "merge" ? (
    <MergeDialog
      number={target.number}
      detail={detail}
      loadError={error}
      open
      onOpenChange={cancel}
      onMerge={async (method, expectedHeadSha) => {
        const { detail: merged } = await run({ kind: "merge", method, expectedHeadSha });
        onFinish(`Merged #${target.number} into ${merged.baseBranch}.`);
      }}
    />
  ) : (
    <CloseDialog
      number={target.number}
      open
      initialComment=""
      onOpenChange={cancel}
      onClose={async (comment) => {
        await run({ kind: "close", ...(comment ? { comment } : {}) });
        onFinish(`Closed #${target.number} without merging.`);
      }}
    />
  );
}
