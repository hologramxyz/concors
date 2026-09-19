import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { PullRequestDetail, PullRequestOperation, WorkspaceSnapshot } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import type { PullRequestTarget } from "./view";

type Action =
  | { kind: "merge"; method: "squash" | "merge" | "rebase"; expectedHeadSha: string }
  | { kind: "close"; comment?: string }
  | { kind: "comment"; body: string };
interface Loaded {
  readonly detail: PullRequestDetail | null;
  readonly error: string | null;
}

/** GitHub computes mergeability lazily; ask again briefly while it reports unknown. */
const MERGEABILITY_RETRIES = 5;
const MERGEABILITY_DELAY_MS = 2500;

/**
 * One pull request, read through the machine that has the workspace. Results are kept per pull
 * request and folder, so a late reply for one never shows as another. Actions answer with the
 * pull request as it is afterwards.
 */
export function usePullRequest(
  workspace: WorkspaceSnapshot | null,
  target: PullRequestTarget | null,
) {
  const connection = useContext(TerminalConnectionContext);
  const project = workspace?.projects.find((item) => item.id === target?.projectId) ?? null;
  const key =
    workspace && project && target
      ? JSON.stringify([
          workspace.epoch,
          project.id,
          project.directory,
          target.repository,
          target.number,
        ])
      : null;
  // Snapshots change constantly; only these fields decide which pull request is shown.
  const base = useMemo(() => {
    if (!key) return null;
    const [epoch, projectId, directory, repository, number] = JSON.parse(key) as [
      string,
      string,
      string,
      string,
      number,
    ];
    return { key, operation: { epoch, projectId, directory, repository, number } };
  }, [key]);
  const [results, setResults] = useState<Record<string, Loaded>>({});
  const [retrying, setRetrying] = useState(false);
  const request = useCallback(
    async (operation: { kind: "detail" } | Action) => {
      if (!connection || !base) throw new Error("Connect to the machine to manage pull requests.");
      const { outcome } = await connection.requestPullRequests(
        { ...operation, ...base.operation } as PullRequestOperation,
        crypto.randomUUID(),
      );
      if (outcome.status === "detail" || outcome.status === "updated") return outcome;
      throw new Error(
        outcome.status === "error" || outcome.status === "signed-out"
          ? outcome.message
          : "Unexpected reply from the machine.",
      );
    },
    [connection, base],
  );
  const load = useCallback(async () => {
    if (!base) return null;
    try {
      const { detail } = await request({ kind: "detail" });
      setResults((previous) => ({ ...previous, [base.key]: { detail, error: null } }));
      return detail;
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : "Could not load this pull request.";
      setResults((previous) => ({
        ...previous,
        [base.key]: { detail: previous[base.key]?.detail ?? null, error },
      }));
      return null;
    }
  }, [base, request]);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (remaining: number) => {
      void load().then((loaded) => {
        if (cancelled || !loaded || remaining <= 0) return;
        if (loaded.state === "open" && loaded.mergeable === "unknown")
          timer = setTimeout(() => attempt(remaining - 1), MERGEABILITY_DELAY_MS);
      });
    };
    attempt(MERGEABILITY_RETRIES);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load]);
  const run = useCallback(
    async (action: Action) => {
      const outcome = await request(action);
      if (base)
        setResults((previous) => ({
          ...previous,
          [base.key]: { detail: outcome.detail, error: null },
        }));
      return outcome;
    },
    [base, request],
  );
  const reload = useCallback(() => {
    setRetrying(true);
    void load().finally(() => setRetrying(false));
  }, [load]);
  const loaded = key ? results[key] : undefined;
  return {
    project,
    detail: loaded?.detail ?? null,
    error: loaded?.error ?? null,
    loading: !loaded || retrying,
    reload,
    run,
  };
}
