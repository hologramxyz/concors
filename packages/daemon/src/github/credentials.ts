import { execFile } from "node:child_process";
import { homedir } from "node:os";

/**
 * The GitHub token already on this machine, used to read pull requests on its owner's behalf.
 *
 * Concors neither asks for nor stores one. It uses what the machine's own tools use, in order:
 * `GH_TOKEN`/`GITHUB_TOKEN`, the GitHub CLI's login, then Git's credential helper for github.com
 * (which is also how managed machines authenticate Git). Every lookup is non-interactive — no
 * terminal prompt, askpass dialog or browser sign-in — and the token never leaves the daemon.
 */
export type CommandRunner = (command: string, args: string[], input?: string) => Promise<string>;

export async function discoverGitHubToken(
  env: NodeJS.ProcessEnv = process.env,
  run: CommandRunner = runQuietly,
): Promise<string | null> {
  const fromEnvironment = env.GH_TOKEN?.trim() || env.GITHUB_TOKEN?.trim();
  if (fromEnvironment) return fromEnvironment;
  try {
    const token = (await run("gh", ["auth", "token", "--hostname", "github.com"])).trim();
    if (/^\S+$/.test(token)) return token;
  } catch {
    /* No GitHub CLI, or not signed in. */
  }
  try {
    const output = await run("git", ["credential", "fill"], "protocol=https\nhost=github.com\n\n");
    const password = /^password=(\S+)$/m.exec(output)?.[1];
    if (password) return password;
  } catch {
    /* No helper has a github.com credential. */
  }
  return null;
}

function runQuietly(command: string, args: string[], input?: string): Promise<string> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    // An empty GIT_ASKPASS also stops Git falling back to core.askPass and SSH_ASKPASS.
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
    GCM_INTERACTIVE: "never",
    GH_PROMPT_DISABLED: "1",
  };
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      { cwd: homedir(), env, timeout: 5000, maxBuffer: 16384, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input ?? "");
  });
}

const TOKEN_TTL_MS = 10 * 60_000;
/** Short, so signing in with `gh auth login` shows pull requests on the next refresh. */
const MISSING_TTL_MS = 30_000;

export class GitHubCredentials {
  #discover: () => Promise<string | null>;
  #cached: { token: string | null; expires: number } | null = null;
  #pending: Promise<string | null> | null = null;
  constructor(discover: () => Promise<string | null> = () => discoverGitHubToken()) {
    this.#discover = discover;
  }

  async token(): Promise<string | null> {
    if (this.#cached && this.#cached.expires > Date.now()) return this.#cached.token;
    this.#pending ??= this.#discover()
      .catch(() => null)
      .then((token) => {
        this.#cached = { token, expires: Date.now() + (token ? TOKEN_TTL_MS : MISSING_TTL_MS) };
        return token;
      })
      .finally(() => {
        this.#pending = null;
      });
    return this.#pending;
  }

  /** GitHub rejected the token: look again next time instead of reusing it. */
  invalidate(): void {
    this.#cached = null;
  }
}
