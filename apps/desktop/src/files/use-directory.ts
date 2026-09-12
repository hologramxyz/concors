import { useContext, useEffect, useState } from "react";
import type { WorkspaceProject } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { useFiles } from "./context";
import { directoryKey, type DirectoryCache, type DirectoryListing } from "./directory-cache";

interface State {
  cache: DirectoryCache;
  key: string;
  listing: DirectoryListing | undefined;
  error: string | null;
  pending: boolean;
}

export function useDirectory(project: WorkspaceProject, path: string, generation: number) {
  const connection = useContext(TerminalConnectionContext);
  const { directories: cache } = useFiles();
  const status = connection?.state.status;
  const machineId = connection?.workspace?.machineId ?? "";
  const epoch = connection?.workspace?.epoch ?? "";
  const { id: projectId, directory } = project;
  const scope = { machineId, epoch, projectId, directory };
  const key = directoryKey(scope, path);
  const [state, setState] = useState<State | null>(null);
  const [retry, setRetry] = useState(0);
  const current = state?.cache === cache && state.key === key ? state : null;

  useEffect(() => {
    let cancelled = false;
    const target = { machineId, epoch, projectId, directory };
    const listing = cache.peek(target, path);
    const previousListing = (previous: State | null) =>
      listing ?? (previous?.cache === cache && previous.key === key ? previous.listing : undefined);
    const ready = connection && status === "ready" && epoch;
    queueMicrotask(() => {
      if (!cancelled)
        setState((previous) => ({
          cache,
          key,
          listing: previousListing(previous),
          error: ready ? null : "Reconnect to browse files.",
          pending: Boolean(ready),
        }));
    });
    if (ready)
      void cache.load(target, path).then(
        (listing) => {
          if (!cancelled) setState({ cache, key, listing, error: null, pending: false });
        },
        (cause) => {
          if (!cancelled)
            setState((previous) => ({
              cache,
              key,
              listing: previousListing(previous),
              error: cause instanceof Error ? cause.message : "Could not load files.",
              pending: false,
            }));
        },
      );
    return () => {
      // The shared request can still populate the cache after this folder is collapsed.
      cancelled = true;
    };
  }, [
    cache,
    connection,
    status,
    machineId,
    epoch,
    projectId,
    directory,
    key,
    path,
    retry,
    generation,
  ]);

  return {
    listing: current?.listing ?? cache.peek(scope, path),
    error: current?.error ?? null,
    pending: current?.pending ?? true,
    retry: () => setRetry((value) => value + 1),
  };
}
