import { GitHubIcon } from "./icon";
import { useEffect, useState } from "react";
import { Check, Lock, Search, RefreshCw, Plus, LoaderCircle } from "lucide-react";
import type { GitHubRepository } from "@concors/api-client";
import { api } from "@/auth/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGitHub } from "./use-github";

interface PickerProps {
  readonly onSelect: (url: string) => void;
  readonly selected: string;
  readonly disabled: boolean;
}
export function GitHubRepositoryPicker(props: PickerProps) {
  const github = useGitHub();
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <GitHubIcon className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{github.status?.login ?? "GitHub"}</span>
        </div>
        <div className="flex items-center gap-1">
          {github.status?.connected && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={props.disabled}
              onClick={() => void github.manage()}
            >
              <Plus className="size-4" /> Add account
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Refresh GitHub"
            disabled={props.disabled}
            onClick={github.refresh}
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>
      {github.status?.connected ? (
        <Repositories
          key={github.status.updatedAt}
          {...props}
          generation={github.generation}
          accounts={github.accounts ?? []}
          accountsLoading={github.accounts === null && !github.error}
        />
      ) : !github.status && !github.error ? (
        <RepositorySkeleton />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-xl border bg-muted/20 p-6 text-center">
          <GitHubIcon className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {github.status?.configured === false
              ? "GitHub is not available. You can paste a repository URL instead."
              : "Connect GitHub to browse your private and organization repositories."}
          </p>
          {github.status?.configured && (
            <Button type="button" disabled={github.busy} onClick={() => void github.connect()}>
              Connect GitHub
            </Button>
          )}
        </div>
      )}
      <div className="h-10 shrink-0 overflow-y-auto text-xs text-muted-foreground">
        {github.error ? (
          <p role="alert" className="text-destructive">
            {github.error}
          </p>
        ) : github.waiting ? (
          <p role="status">
            Finish setup on GitHub, then return here.{" "}
            {github.authorizeUrl && (
              <a href={github.authorizeUrl} target="_blank" rel="noreferrer" className="underline">
                Continue on GitHub
              </a>
            )}
          </p>
        ) : (
          <p>Missing a repository? Use Add account to manage access on GitHub.</p>
        )}
      </div>
    </div>
  );
}
function RepositorySkeleton() {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3"
      role="status"
      aria-label="Loading repositories"
    >
      <div className="h-9 shrink-0 rounded-lg bg-muted/60 motion-safe:animate-pulse" />
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="flex h-16 items-center gap-3 border-b px-4 motion-safe:animate-pulse"
          >
            <span className="size-5 rounded bg-muted" />
            <span className="h-3 w-2/5 rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="h-8 shrink-0" />
    </div>
  );
}

function Repositories({
  onSelect,
  selected,
  disabled,
  generation,
  accounts,
  accountsLoading,
}: PickerProps & {
  generation: number;
  accounts: { id: number; login: string }[];
  accountsLoading: boolean;
}) {
  const [selectedInstallation, setInstallation] = useState<number | null>(null);
  const installation = accounts.some((account) => account.id === selectedInstallation)
    ? selectedInstallation
    : (accounts[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const [pagination, setPagination] = useState({ generation, page: 1 });
  const page = pagination.generation === generation ? pagination.page : 1;
  const key = `${installation}:${generation}:${page}`;
  const [result, setResult] = useState<{
    key: string;
    installation: number | null;
    generation: number;
    repos: GitHubRepository[];
    nextPage: number | null;
    error: string | null;
  }>({ key: "", installation: null, generation: -1, repos: [], nextPage: null, error: null });
  useEffect(() => {
    if (!installation) return;
    let cancelled = false;
    void api
      .githubRepositories(installation, page)
      .then((data) => {
        if (!cancelled)
          setResult((current) => ({
            key,
            installation,
            generation,
            error: null,
            nextPage: data.nextPage,
            repos:
              page > 1 && current.installation === installation && current.generation === generation
                ? [...current.repos, ...data.repositories]
                : data.repositories,
          }));
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setResult((current) => ({
            key,
            installation,
            generation,
            repos: current.installation === installation ? current.repos : [],
            nextPage: null,
            error: cause instanceof Error ? cause.message : "Could not list repositories",
          }));
      });
    return () => {
      cancelled = true;
    };
  }, [installation, page, generation, key]);
  const loading = result.key !== key;
  // Keep the current rows (and their scroll container) mounted during background refresh.
  const repos = result.installation === installation ? result.repos : [];
  const nextPage = loading ? null : result.nextPage;
  const error = loading ? null : result.error;
  const visible = repos.filter((repo) => repo.fullName.toLowerCase().includes(query.toLowerCase()));
  if (accountsLoading) return <RepositorySkeleton />;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <>
        {accounts.length > 0 ? (
          <>
            <div className="flex h-9 shrink-0 gap-2">
              <select
                aria-label="GitHub account"
                className="h-9 max-w-[45%] min-w-0 rounded-md border bg-background px-2 text-sm"
                disabled={disabled}
                value={installation ?? ""}
                onChange={(event) => {
                  setInstallation(Number(event.target.value));
                  onSelect("");
                  setPagination({ generation, page: 1 });
                  setQuery("");
                }}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.login}
                  </option>
                ))}
              </select>
              <div className="relative min-w-0 flex-1">
                <Search
                  className="absolute top-2.5 left-3 size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  aria-label="Search repositories"
                  placeholder="Search repositories…"
                  className="h-9 pl-9"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
            <div
              aria-label="GitHub repositories"
              aria-busy={loading}
              className="min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto rounded-xl border"
            >
              {visible.map((repo) => (
                <button
                  key={repo.id}
                  type="button"
                  aria-pressed={selected === repo.url}
                  disabled={disabled}
                  onClick={() => onSelect(repo.url)}
                  className={`flex min-h-16 w-full items-center gap-3 border-b px-4 py-3 text-left outline-none last:border-0 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${selected === repo.url ? "bg-primary/10" : ""}`}
                >
                  <GitHubIcon
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{repo.fullName}</span>
                    {repo.description && (
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {repo.description}
                      </span>
                    )}
                  </span>
                  {selected === repo.url && (
                    <Check className="size-4 shrink-0 text-primary" aria-label="Selected" />
                  )}
                  {repo.private && (
                    <Lock
                      aria-label="Private repository"
                      className="mt-0.5 size-3 shrink-0 text-muted-foreground"
                    />
                  )}
                </button>
              ))}
              {!loading && visible.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  {query ? "No matches in the loaded repositories." : "No repositories available."}
                </p>
              )}
              {loading && repos.length === 0 && (
                <div role="status" aria-label="Loading repositories">
                  {Array.from({ length: 6 }, (_, index) => (
                    <div
                      key={index}
                      className="flex h-16 items-center gap-3 border-b px-4 motion-safe:animate-pulse"
                      aria-hidden="true"
                    >
                      <span className="size-4 rounded bg-muted" />
                      <span className="h-3 w-2/5 rounded bg-muted" />
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div
              className="flex h-8 shrink-0 items-center justify-between gap-2 text-xs text-muted-foreground"
              role="status"
            >
              <span>
                {error ? (
                  <span role="alert" className="text-destructive">
                    {error}
                  </span>
                ) : loading ? (
                  <span className="inline-flex items-center gap-2">
                    <LoaderCircle className="size-3 animate-spin" />
                    {repos.length ? "Refreshing repositories…" : "Loading repositories…"}
                  </span>
                ) : (
                  `${repos.length} ${repos.length === 1 ? "repository" : "repositories"} loaded`
                )}
              </span>
              {nextPage !== null && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={loading}
                  onClick={() => setPagination({ generation, page: nextPage })}
                >
                  Load more repositories
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className="flex flex-1 items-center justify-center rounded-xl border p-6 text-center text-sm text-muted-foreground">
            {accountsLoading
              ? "Loading accounts…"
              : "Choose Add account to select repositories on GitHub. Access refreshes when you return."}
          </p>
        )}
      </>
    </div>
  );
}
