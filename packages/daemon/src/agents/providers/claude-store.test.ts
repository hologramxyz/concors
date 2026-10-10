import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSubagentMessages, listSubagents } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, expect, it } from "vitest";
import { claudeStore } from "./claude-store.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
  directories.length = 0;
});

const session = "4b8686b9-7634-432b-b0a8-91460c0dcb15";
const entry = (
  uuid: string,
  parentUuid: string | null,
  role: "user" | "assistant",
  text: string,
) => ({
  type: role,
  uuid,
  parentUuid,
  sessionId: session,
  agentId: "a1b2c3",
  isSidechain: true,
  timestamp: "2026-10-09T12:00:00.000Z",
  message:
    role === "user"
      ? { role, content: text }
      : { role, content: [{ type: "text", text }], model: "claude", id: uuid },
});

it("reads a sub-agent's conversation from a non-default account's directory", async () => {
  const account = await realpath(await mkdtemp(join(tmpdir(), "concors-claude-account-")));
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "concors-claude-project-")));
  directories.push(account, cwd);
  const projectKey = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  const sessionDir = join(account, "projects", projectKey, session);
  await mkdir(join(sessionDir, "subagents"), { recursive: true });
  await writeFile(join(account, "projects", projectKey, `${session}.jsonl`), "");
  await writeFile(
    join(sessionDir, "subagents", "agent-a1b2c3.jsonl"),
    [
      entry("u1", null, "user", "Find where the composer wraps"),
      entry("u2", "u1", "assistant", "The toolbar uses flex-wrap."),
    ]
      .map((line) => JSON.stringify(line))
      .join("\n") + "\n",
  );
  const store = claudeStore(account);

  expect(await store.listSubkeys?.({ projectKey, sessionId: session })).toEqual([
    "subagents/agent-a1b2c3",
  ]);
  expect(await listSubagents(session, { dir: cwd, sessionStore: store })).toEqual(["a1b2c3"]);
  const messages = await getSubagentMessages(session, "a1b2c3", { dir: cwd, sessionStore: store });
  expect(messages.map((m) => m.type)).toEqual(["user", "assistant"]);
  expect(JSON.stringify(messages)).toContain("The toolbar uses flex-wrap.");
});

it("writes sub-agent entries beside their session and keeps keys inside the account", async () => {
  const account = await mkdtemp(join(tmpdir(), "concors-claude-account-"));
  directories.push(account);
  const store = claudeStore(account);
  const key = { projectKey: "-tmp-app", sessionId: session, subpath: "subagents/agent-x" };
  await store.append(key, [{ type: "user", uuid: "u1" }]);
  expect(
    await readFile(
      join(account, "projects", "-tmp-app", session, "subagents", "agent-x.jsonl"),
      "utf8",
    ),
  ).toBe('{"type":"user","uuid":"u1"}\n');
  expect(await store.load(key)).toEqual([{ type: "user", uuid: "u1" }]);
  expect(await store.listSubkeys?.({ projectKey: "-tmp-app", sessionId: "missing" })).toEqual([]);
  await expect(store.load({ ...key, subpath: "subagents/../../escape" })).rejects.toThrow(
    /Invalid transcript key/,
  );
});
