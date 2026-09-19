import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { z } from "zod";
import { launch } from "../providers/launch.ts";
import { browserUrl, type AccountBackend, type AccountChallenge } from "./backend.ts";

/** Use the CLI's supported auth commands; Claude owns its credential storage and OAuth exchange. */
export class ClaudeAccount implements AccountBackend {
  private children = new Set<ChildProcessWithoutNullStreams>();
  private login: ChildProcessWithoutNullStreams | undefined;
  private closed = false;
  private cwd: string;
  private spawn: typeof launch;
  constructor(cwd: string, spawn = launch) {
    this.cwd = cwd;
    this.spawn = spawn;
  }
  private child(args: string[]) {
    if (this.closed) throw new Error("Account connection closed");
    const child = this.spawn("claude", args, this.cwd);
    this.children.add(child);
    child.once("close", () => this.children.delete(child));
    return child;
  }
  async read() {
    const child = this.child(["auth", "status", "--json"]);
    const output = await new Promise<string>((resolve, reject) => {
      let text = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("Claude account check timed out"));
      }, 10000);
      child.stdout.on("data", (data: Buffer) => {
        text += data.toString();
        if (text.length > 64000) {
          child.kill();
          reject(new Error("Invalid Claude account response"));
        }
      });
      child.stderr.resume();
      child.once("error", () => {
        clearTimeout(timer);
        reject(new Error("Could not check Claude account"));
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (code === 0 || code === 1) resolve(text);
        else reject(new Error("Could not check Claude account"));
      });
      child.stdin.end();
    });
    const status = z
      .object({ loggedIn: z.boolean(), email: z.string().nullable().optional() })
      .parse(JSON.parse(output));
    return {
      connected: status.loggedIn,
      ...(status.email ? { label: status.email.slice(0, 250) } : {}),
      methods: [
        { id: "claudeai", label: "Sign in with Claude", kind: "browser" as const },
        { id: "console", label: "Sign in with Anthropic Console", kind: "browser" as const },
      ],
    };
  }
  start(methodId: string, done: (error?: Error) => void): Promise<AccountChallenge> {
    if (!["claudeai", "console"].includes(methodId)) throw new Error("Unknown sign-in method");
    const child = this.child(["auth", "login", `--${methodId}`]);
    this.login = child;
    return new Promise((resolve, reject) => {
      let output = "";
      let found = false;
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("Claude did not provide a sign-in link. Try again."));
      }, 20000);
      const read = (data: Buffer) => {
        if (found) return;
        output = (output + data.toString()).slice(-16000);
        const match = /https:\/\/[^\s]+(?=\s)/.exec(stripVTControlCharacters(output));
        if (!match) return;
        try {
          const url = browserUrl(match[0]);
          if (
            ![
              "claude.com",
              "claude.ai",
              "console.anthropic.com",
              "platform.claude.com",
              "auth.anthropic.com",
            ].includes(new URL(url).hostname)
          )
            throw new Error("Claude returned an unexpected sign-in domain");
          found = true;
          clearTimeout(timer);
          resolve({
            url,
            input: "code",
            instructions:
              "Sign in in your browser. If it shows an authorization code, paste it below.",
          });
        } catch {
          child.kill();
          reject(new Error("Could not read Claude's sign-in link"));
        }
      };
      child.stdout.on("data", read);
      child.stderr.on("data", read);
      child.stdin.on("error", () => done(new Error("Claude sign-in closed. Try again.")));
      child.once("error", () => {
        clearTimeout(timer);
        reject(new Error("Could not start Claude sign-in"));
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (!found) reject(new Error("Claude sign-in ended before providing a link"));
        else if (!this.closed)
          done(code === 0 ? undefined : new Error("Claude sign-in did not complete. Try again."));
      });
    });
  }
  async complete(value: string) {
    if (
      !this.login ||
      this.login.exitCode !== null ||
      /[\r\n]/.test(value) ||
      value.includes(String.fromCharCode(0))
    )
      throw new Error("Invalid or expired authorization code");
    this.login.stdin.write(value + "\n");
  }
  async close() {
    this.closed = true;
    await Promise.all(
      [...this.children].map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) return resolve();
            const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
            child.once("close", () => {
              clearTimeout(timer);
              resolve();
            });
            child.kill();
          }),
      ),
    );
  }
}
