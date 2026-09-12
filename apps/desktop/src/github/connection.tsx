import { GitHubIcon } from "./icon";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openExternal } from "@/tauri";
import type { useGitHub } from "./use-github";
export function GitHubConnection({ github }: { readonly github: ReturnType<typeof useGitHub> }) {
  const { status, error, busy, waiting } = github;
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
                    ? "Connected across your VPSs."
                    : "Connect once to use your repositories on any VPS."}
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
                onClick={() => {
                  if (status.manageUrl) void openExternal(status.manageUrl);
                }}
              >
                Manage repositories
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
      {waiting && (
        <p role="status" className="text-xs text-muted-foreground">
          Finish connecting in GitHub, then return here.{" "}
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
