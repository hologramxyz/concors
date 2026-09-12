import type { DaemonConnection } from "@concors/daemon-client";
import type { FileResult } from "@concors/protocol";

export interface DirectoryScope {
  machineId: string;
  epoch: string;
  projectId: string;
  directory: string;
}
export type DirectoryListing = Extract<FileResult["outcome"], { status: "listed" }>;
interface Entry {
  scope: string;
  listing: DirectoryListing | undefined;
  expires: number;
  pending?: Promise<DirectoryListing> | undefined;
}
function scopeKey(scope: DirectoryScope) {
  return JSON.stringify([scope.machineId, scope.epoch, scope.projectId, scope.directory]);
}
export function directoryKey(scope: DirectoryScope, path: string) {
  return JSON.stringify([scopeKey(scope), path]);
}

/** Session-only listings: reopening a folder is instant, stale rows stay visible while reloading. */
export class DirectoryCache {
  private entries = new Map<string, Entry>();
  private connection: Pick<DaemonConnection, "requestFile">;

  constructor(connection: Pick<DaemonConnection, "requestFile">) {
    this.connection = connection;
  }

  peek(scope: DirectoryScope, path: string): DirectoryListing | undefined {
    return this.entries.get(directoryKey(scope, path))?.listing;
  }

  load(scope: DirectoryScope, path: string): Promise<DirectoryListing> {
    const key = directoryKey(scope, path);
    let entry = this.entries.get(key);
    // Touch on use, not render. Bound memory even when browsing many projects or folders.
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
      if (entry.pending) return entry.pending;
      if (entry.listing && entry.expires > Date.now()) return Promise.resolve(entry.listing);
    }
    entry = { scope: scopeKey(scope), listing: entry?.listing, expires: 0 };
    this.entries.set(key, entry);
    while (this.entries.size > 64) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    const current = entry;
    current.pending = Promise.resolve()
      .then(() =>
        this.connection.requestFile(
          {
            kind: "list",
            projectId: scope.projectId,
            directory: scope.directory,
            epoch: scope.epoch,
            path,
          },
          crypto.randomUUID(),
        ),
      )
      .then((result) => {
        if (result.outcome.status !== "listed")
          throw new Error(
            "message" in result.outcome ? result.outcome.message : "Could not list this folder.",
          );
        // A refresh, reconnect or eviction may have superseded this request.
        if (this.entries.get(key) === current) {
          current.listing = result.outcome;
          current.expires = Date.now() + 30_000;
        }
        return result.outcome;
      })
      .finally(() => {
        current.pending = undefined;
      });
    return current.pending;
  }

  /** Invalidate collapsed folders too, retaining their last successful rows during refresh. */
  invalidate(scope?: DirectoryScope) {
    const match = scope && scopeKey(scope);
    for (const [key, entry] of this.entries) {
      if (match === undefined || entry.scope === match)
        this.entries.set(key, { scope: entry.scope, listing: entry.listing, expires: 0 });
    }
  }
}
