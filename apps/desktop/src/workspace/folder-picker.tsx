import { useContext, useEffect, useState } from "react";
import { ArrowUp, Folder, Home, Search } from "lucide-react";
import type { ProjectResult } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Listing = Extract<ProjectResult["outcome"], { status: "listed" }>;
export function FolderPicker({
  disabled,
  onChange,
}: {
  disabled: boolean;
  onChange: (directory: string) => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const [directory, setDirectory] = useState("~");
  const [path, setPath] = useState("~");
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const workspace = connection?.workspace;
    if (!workspace) return;
    void connection
      .requestProject({ kind: "browse", epoch: workspace.epoch, directory }, crypto.randomUUID())
      .then(({ outcome }) => {
        if (cancelled) return;
        if (outcome.status !== "listed")
          throw new Error("message" in outcome ? outcome.message : "Could not browse folders.");
        setListing(outcome);
        setPath(outcome.directory);
        onChange(outcome.directory);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Could not browse folders.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, directory, generation, onChange]);
  const browse = (next: string) => {
    onChange("");
    setLoading(true);
    setError(null);
    setFilter("");
    setDirectory(next);
    setGeneration((value) => value + 1);
  };
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Home folder"
          disabled={disabled || loading}
          onClick={() => browse("~")}
        >
          <Home />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Parent folder"
          disabled={disabled || loading || !listing?.parent}
          onClick={() => listing?.parent && browse(listing.parent)}
        >
          <ArrowUp />
        </Button>
        <Input
          aria-label="Folder path"
          value={path}
          maxLength={4096}
          disabled={disabled}
          onChange={(event) => setPath(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              browse(path);
            }
          }}
          className="min-w-0 flex-1"
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled || loading || !path.trim()}
          onClick={() => browse(path)}
        >
          Go
        </Button>
      </div>
      <div className="relative">
        <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
        <Input
          aria-label="Filter folders"
          placeholder="Filter folders"
          value={filter}
          disabled={disabled || loading}
          onChange={(event) => setFilter(event.target.value)}
          className="pl-9"
        />
      </div>
      <div
        className="h-52 overflow-auto rounded-md border"
        aria-label="Folders on this machine"
        aria-busy={loading}
      >
        {loading ? (
          <p role="status" className="p-3 text-ui text-muted-foreground">
            Loading folders…
          </p>
        ) : error ? (
          <div className="space-y-2 p-3">
            <p role="alert" className="text-ui text-destructive">
              {error}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => browse(directory)}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {listing?.entries
              .filter(
                (entry) =>
                  (showHidden || !entry.name.startsWith(".")) &&
                  entry.name.toLowerCase().includes(filter.toLowerCase()),
              )
              .map((entry) => (
                <button
                  key={entry.directory}
                  type="button"
                  disabled={disabled}
                  onClick={() => browse(entry.directory)}
                  className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-ui hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{entry.name}</span>
                </button>
              ))}
            {!listing?.entries.some(
              (entry) =>
                (showHidden || !entry.name.startsWith(".")) &&
                entry.name.toLowerCase().includes(filter.toLowerCase()),
            ) && (
              <p className="p-3 text-ui text-muted-foreground">
                {filter ? "No matching folders" : "No subfolders"}
              </p>
            )}
            {listing?.truncated && (
              <p className="p-3 text-ui text-muted-foreground">
                Folder list is limited. Enter a path to open another folder.
              </p>
            )}
          </>
        )}
      </div>
      <label className="flex items-center gap-2 text-ui text-muted-foreground">
        <input
          type="checkbox"
          checked={showHidden}
          onChange={(event) => setShowHidden(event.target.checked)}
        />
        Show hidden folders
      </label>
      <p className="text-ui break-all text-muted-foreground">
        {listing ? `Open ${listing.directory}` : "Choose a folder on the selected machine."}
      </p>
    </div>
  );
}
