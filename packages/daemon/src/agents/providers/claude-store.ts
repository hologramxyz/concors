import { appendFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import type { SessionStore } from "@anthropic-ai/claude-agent-sdk";

/** Keeps SDK transcript helpers in the same account directory as the configured CLI. */
export function claudeStore(directory: string): SessionStore {
  const component = (value: string) => {
    if (!value || value === "." || value === ".." || /[/\\\0]/.test(value))
      throw new Error("Invalid transcript key");
    return value;
  };
  const project = (key: string) => join(directory, "projects", component(key));
  // Sub-agent transcripts sit beside their session as the CLI writes them:
  // <session>/subagents/agent-<id>.jsonl for the subpath "subagents/agent-<id>".
  const file = (key: { projectKey: string; sessionId: string; subpath?: string }) =>
    key.subpath
      ? join(
          project(key.projectKey),
          component(key.sessionId),
          ...key.subpath.split("/").map(component),
        ) + ".jsonl"
      : join(project(key.projectKey), component(key.sessionId) + ".jsonl");
  return {
    async append(key, entries) {
      await mkdir(dirname(file(key)), { recursive: true, mode: 0o700 });
      await appendFile(file(key), entries.map((e) => JSON.stringify(e)).join("\n") + "\n", {
        mode: 0o600,
      });
    },
    async load(key) {
      try {
        const path = file(key);
        if ((await stat(path)).size > 64 * 1024 * 1024)
          throw new Error("Transcript exceeds the 64 MB recovery limit");
        const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
        return lines.flatMap((line, index) => {
          try {
            return [JSON.parse(line) as { type: string }];
          } catch (error) {
            if (index === lines.length - 1) return [];
            throw error;
          }
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async listSubkeys(key) {
      try {
        const dir = join(project(key.projectKey), component(key.sessionId));
        const names = await readdir(dir, { recursive: true });
        return names
          .filter((name) => name.endsWith(".jsonl"))
          .map((name) => name.slice(0, -6).split(sep).join("/"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    },
    async listSessions(key) {
      try {
        const dir = project(key);
        const entries = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
        return Promise.all(
          entries.map(async (name) => ({
            sessionId: name.slice(0, -6),
            mtime: Math.floor((await stat(join(dir, name))).mtimeMs),
          })),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    },
  };
}
