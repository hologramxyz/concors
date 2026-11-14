import { stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { sep } from "node:path";
import { z } from "zod";
import { canonicalDirectory } from "./providers/session-directory.ts";
import {
  NativeSessionPageSchema,
  type NativeSession,
  type NativeSessionPage,
  type RecentAgentFolder,
} from "@concors/protocol";
import type { AgentProviderFactory } from "./providers/index.ts";
import type { ConversationProvider } from "./providers/contract.ts";
import type { ProviderRegistry } from "./providers/registry.ts";

/**
 * Where throwaway work lands, which is no project anyone wants back. An object so a test whose own
 * folders live there can look past it.
 */
export const TEMPORARY_FOLDERS = {
  roots: (): string[] => [tmpdir(), "/tmp", "/private/tmp", "/var/folders", "/private/var/folders"],
};

/** Whether setup offers a folder an agent was used in as a project. */
export function isProjectFolder(directory: string, home: string, temporary: readonly string[]) {
  // The home folder holds everything, and a temporary folder holds nothing worth keeping.
  if (directory === home || directory === "/" || directory === sep) return false;
  // Either separator: CLIs on Windows write both kinds of path.
  return !temporary.some(
    (root) =>
      directory === root || directory.startsWith(root + "/") || directory.startsWith(root + "\\"),
  );
}

/** The CLIs whose own history says which folders they were used in. */
const FOLDER_ENGINES = ["claude", "codex"];
const RecentFoldersSchema = z.object({
  folders: z
    .array(z.object({ directory: z.string().min(1).max(4096), updatedAt: z.string().datetime() }))
    .max(1000),
});

/** Short-lived, machine-local discovery. Never starts a thread or sends/approves a prompt. */
export class NativeSessions {
  private pages = new Map<string, { expires: number; value: Promise<NativeSessionPage> }>();
  private offered = new Map<string, { expires: number; session: NativeSession }>();
  private probes = new Set<ConversationProvider>();
  private closed = false;
  private factory: AgentProviderFactory;
  private registry: ProviderRegistry;
  constructor(factory: AgentProviderFactory, registry: ProviderRegistry) {
    this.factory = factory;
    this.registry = registry;
  }

  private key(provider: string, directory: string, id: string) {
    return JSON.stringify([this.registry.revision, provider, directory, id]);
  }

  selected(provider: string, directory: string, id: string) {
    const entry = this.offered.get(this.key(provider, directory, id));
    if (!entry || entry.expires < Date.now())
      throw new Error("Refresh the session list before resuming this conversation.");
    if (entry.session.busy)
      throw new Error("This session is still working. Stop it in its original client first.");
    return entry.session;
  }

  async list(provider: string, directory: string, cursor?: string, query = "", refresh = false) {
    if (this.closed) throw new Error("Daemon is shutting down");
    const config = this.registry.config(provider);
    if (!config.enabled || !this.registry.installed(config))
      throw new Error("This provider is not installed or enabled on this machine.");
    const key = this.key(provider, directory, cursor ?? "");
    let entry = this.pages.get(key);
    if (refresh && entry?.expires !== Infinity) entry = undefined;
    if (!entry || entry.expires < Date.now()) {
      if (this.probes.size >= 4) throw new Error("Session discovery is busy. Try again shortly.");
      const value = this.probe(provider, directory, config.engine, cursor);
      entry = { expires: Infinity, value };
      this.pages.set(key, entry);
      const current = entry;
      void value.then(
        () => {
          current.expires = Date.now() + 30_000;
        },
        () => {
          if (this.pages.get(key) === current) this.pages.delete(key);
        },
      );
      if (this.pages.size > 128) this.pages.delete(this.pages.keys().next().value ?? "");
    }
    const page = await entry.value;
    const needle = query.trim().toLocaleLowerCase();
    return {
      ...page,
      sessions: page.sessions.filter(
        (session) =>
          !needle || `${session.title} ${session.id}`.toLocaleLowerCase().includes(needle),
      ),
    };
  }

  private async probe(provider: string, directory: string, engine: string, cursor?: string) {
    const transport = this.factory(
      directory,
      async () => {
        throw new Error("Session discovery cannot approve tools or send prompts.");
      },
      provider,
    );
    this.probes.add(transport);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const page = await Promise.race([
        (async () => {
          // These adapters read native transcript files directly, without launching a CLI.
          if (!["claude", "pi", "omp"].includes(engine)) await transport.initialize();
          if (this.closed || !this.probes.has(transport)) throw new Error("Discovery cancelled");
          return NativeSessionPageSchema.parse(
            await transport.request("session/list", {
              cwd: directory,
              cursor,
              limit: 100,
            }),
          );
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Session discovery timed out. Try again.")),
            15_000,
          );
        }),
      ]);
      const canonical = await canonicalDirectory(directory);
      const sessions: NativeSession[] = [];
      for (const session of page.sessions) {
        if ((await canonicalDirectory(session.directory)) !== canonical) continue;
        sessions.push(session);
        this.offered.set(this.key(provider, directory, session.id), {
          session,
          expires: Date.now() + 5 * 60_000,
        });
      }
      for (const [key, value] of this.offered)
        if (value.expires < Date.now()) this.offered.delete(key);
      while (this.offered.size > 10_000)
        this.offered.delete(this.offered.keys().next().value ?? "");
      return { sessions, nextCursor: page.nextCursor === cursor ? null : page.nextCursor };
    } finally {
      clearTimeout(timer);
      this.probes.delete(transport);
      await transport.close().catch(() => undefined);
    }
  }

  /**
   * Where the installed agent CLIs were used most recently, newest first, so setup can offer those
   * folders as projects. Each CLI answers from its own history (Claude Code's transcripts, Codex's
   * threads); one that fails or takes too long is left out rather than failing the list.
   */
  async folders(): Promise<RecentAgentFolder[]> {
    if (this.closed) throw new Error("Daemon is shutting down");
    const home = homedir();
    const providers = this.registry
      .configs()
      .filter(
        (config) =>
          config.enabled &&
          FOLDER_ENGINES.includes(config.engine) &&
          this.registry.installed(config),
      );
    const answers = await Promise.all(
      providers.map((config) =>
        this.ask(config.id, config.engine, home).then(
          (folders) => folders.map((folder) => ({ ...folder, provider: config.id })),
          () => [],
        ),
      ),
    );
    const newest = new Map<string, RecentAgentFolder>();
    for (const folder of answers.flat()) {
      const known = newest.get(folder.directory);
      if (!known || known.updatedAt < folder.updatedAt) newest.set(folder.directory, folder);
    }
    const temporary = TEMPORARY_FOLDERS.roots();
    const found: RecentAgentFolder[] = [];
    for (const folder of [...newest.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )) {
      if (found.length >= 20) break;
      if (!isProjectFolder(folder.directory, home, temporary)) continue;
      // A removed folder can no longer be opened.
      if (
        !(await stat(folder.directory).then(
          (s) => s.isDirectory(),
          () => false,
        ))
      )
        continue;
      found.push(folder);
    }
    return found;
  }

  private async ask(provider: string, engine: string, home: string) {
    const transport = this.factory(
      home,
      async () => {
        throw new Error("Folder discovery cannot approve tools or send prompts.");
      },
      provider,
    );
    this.probes.add(transport);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          if (engine !== "claude") await transport.initialize();
          return RecentFoldersSchema.parse(await transport.request("session/folders", {})).folders;
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Folder discovery timed out")), 15_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      this.probes.delete(transport);
      await transport.close().catch(() => undefined);
    }
  }

  async close() {
    this.closed = true;
    this.pages.clear();
    this.offered.clear();
    await Promise.all([...this.probes].map((probe) => probe.close().catch(() => undefined)));
    this.probes.clear();
  }
}
