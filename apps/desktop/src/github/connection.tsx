import { GitHubIcon } from "./icon";
import { RefreshCw } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { useGitHub } from "./use-github";
export function GitHubConnection({ github }: { readonly github: ReturnType<typeof useGitHub> }) {
  const { status, accounts, error, busy, waiting } = github;
  const identityConnected = status?.identityConnected ?? false;
  return (
    <div className="space-y-3">
      <div
        role="group"
        aria-label="GitHub integration"
        className={cn(
          "grid gap-4 rounded-xl border p-4",
          // A connected row keeps its actions on their own line, so the account name shows in full.
          !status?.connected && "md:grid-cols-[minmax(0,1fr)_auto] md:items-center",
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <GitHubIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm font-medium">
                GitHub
                {status?.connected && (
                  <span className="min-w-0 font-normal break-all text-muted-foreground">
                    {status.login}
                  </span>
                )}
              </p>
              {(status?.connected || identityConnected) && (
                <Badge variant="secondary">Connected</Badge>
              )}
            </div>
            {/* Connected says so in its badge; there is only more to say when it needs doing. */}
            {!(status?.connected && accounts?.length !== 0) && (
              <p className="mt-1 text-xs text-muted-foreground">
                {!status
                  ? error
                    ? "Could not check connection."
                    : "Checking connection…"
                  : !status.configured
                    ? "GitHub integration is not available yet."
                    : status.connected
                      ? "GitHub connected. Choose an account or organization to access its repositories."
                      : identityConnected
                        ? "Connected for sign-in. Enable repository access to use private repositories on your VPSs."
                        : "Connect GitHub, then choose your accounts and repositories."}
              </p>
            )}
          </div>
        </div>
        <div className={cn("flex flex-wrap gap-2", status?.connected ? "pl-8" : "md:justify-end")}>
          {status?.configured && (
            <Button
              type="button"
              size="sm"
              variant={status.connected ? "outline" : "default"}
              disabled={busy}
              onClick={() => void github.connect()}
            >
              {status.connected
                ? "Reconnect"
                : identityConnected
                  ? "Enable repository access"
                  : "Connect GitHub"}
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
