import { GitHubIcon } from "./icon";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { useGitHub } from "./use-github";
export function GitHubConnection({ github }: { readonly github: ReturnType<typeof useGitHub> }) {
  const { status, accounts, error, busy, waiting } = github;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
        <div className="flex items-center gap-3">
          <GitHubIcon className="size-5" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">
              {status?.connected ? `GitHub · ${status.login}` : "GitHub"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {!status
                ? "Checking connection…"
                : !status.configured
                  ? "GitHub integration is not available yet."
                  : status.connected
                    ? accounts?.length === 0
                      ? "GitHub connected. Choose an account or organization to access its repositories."
                      : "Connected across your VPSs."
                    : "Connect GitHub, then choose your accounts and repositories."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {status?.configured && (
            <Button
              type="button"
              size="sm"
              variant={status.connected ? "outline" : "default"}
              disabled={busy}
              onClick={() => void github.connect()}
            >
              {status.connected ? "Reconnect" : "Connect GitHub"}
            </Button>
          )}
          {status?.connected && (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void github.manage()}
              >
                Add account or organization
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void github.disconnect()}
              >
                Disconnect
              </Button>
            </>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Refresh GitHub"
            onClick={github.refresh}
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>
      {status?.connected && (
        <div className="space-y-2 px-1">
          <p className="text-xs font-medium">Repository access</p>
          {accounts === null ? (
            <p className="text-xs text-muted-foreground">Loading accounts…</p>
          ) : accounts.length > 0 ? (
            <div className="flex flex-wrap gap-2" aria-label="Accounts with repository access">
              {accounts.map((account) => (
                <span key={account.id} className="rounded-md border px-2 py-1 text-xs">
                  {account.login}
                </span>
              ))}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Missing an organization or repository? Add it on GitHub and choose all repositories or
            specific ones. Some organizations require an owner’s approval.
          </p>
        </div>
      )}
      {waiting && (
        <p role="status" className="text-xs text-muted-foreground">
          {status?.connected
            ? "Choose repository access on GitHub, then return here. "
            : "Finish connecting in GitHub, then choose repository access. "}
          {github.authorizeUrl && (
            <a
              className="underline underline-offset-4"
              href={github.authorizeUrl}
              target="_blank"
              rel="noreferrer"
            >
              Continue on GitHub
            </a>
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
