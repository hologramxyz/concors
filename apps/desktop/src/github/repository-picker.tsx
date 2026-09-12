import { GitHubIcon } from "./icon";
import { useEffect, useState } from "react";
import { Lock, Search } from "lucide-react";
import type { GitHubRepository } from "@concors/api-client";
import { api } from "@/auth/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGitHub } from "./use-github";
import { GitHubConnection } from "./connection";

interface PickerProps {
  readonly onSelect: (url: string) => void;
  readonly selected: string;
  readonly disabled: boolean;
}
export function GitHubRepositoryPicker(props: PickerProps) {
  const github = useGitHub();
  return (
    <div className="space-y-3">
      <GitHubConnection github={github} />
      {github.status?.connected && (
        <Repositories
          key={github.status.updatedAt}
          {...props}
          generation={github.generation}
          accounts={github.accounts ?? []}
          accountsLoading={github.accounts === null}
        />
      )}
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
            repos:
              page > 1 && current.installation === installation && current.generation === generation
                ? current.repos
                : [],
            nextPage: null,
            error: cause instanceof Error ? cause.message : "Could not list repositories",
          }));
      });
    return () => {
      cancelled = true;
    };
  }, [installation, page, generation, key]);
  const loading = result.key !== key;
  const repos =
    result.installation === installation && result.generation === generation ? result.repos : [];
  const nextPage = loading ? null : result.nextPage;
  const error = loading ? null : result.error;
  const visible = repos.filter((repo) => repo.fullName.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="space-y-3">
      <>
        {accounts.length > 0 ? (
          <>
            <div className="flex gap-2">
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
                  className="pl-9"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
            <div
              aria-label="GitHub repositories"
              className="max-h-52 overflow-y-auto rounded-lg border"
            >
              {visible.map((repo) => (
                <button
                  key={repo.id}
                  type="button"
                  aria-pressed={selected === repo.url}
                  disabled={disabled}
                  onClick={() => onSelect(repo.url)}
                  className={`flex w-full items-start gap-3 border-b px-3 py-3 text-left last:border-0 hover:bg-muted/50 ${selected === repo.url ? "bg-muted" : ""}`}
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
              {loading && (
                <p role="status" className="p-4 text-sm text-muted-foreground">
                  Loading repositories…
                </p>
              )}
            </div>
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
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {accountsLoading
              ? "Loading accounts…"
              : "Choose Add account or organization to select repositories on GitHub. Access refreshes when you return."}
          </p>
        )}
      </>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
