import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type {
  AgentUpload,
  ScheduleDefinition,
  ScheduleOperation,
  ScheduleRequest,
  AgentSchedule,
} from "@concors/protocol";
import { WorkspaceStore } from "../workspace/store.ts";
import { AgentManager } from "../agents/manager.ts";
import { ProviderRegistry } from "../agents/providers/registry.ts";
import { TestAgentProvider } from "../agents/testing/provider.ts";
import { ScheduleStore } from "./store.ts";
import { ScheduleManager } from "./manager.ts";
import { ScheduleTools } from "./tools.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "concors-schedules-"));
  const workspace = new WorkspaceStore(join(directory, "workspace.sqlite"));
  const registry = new ProviderRegistry(join(directory, "providers"));
  vi.spyOn(registry, "installed").mockReturnValue(true);
  const providers: TestAgentProvider[] = [];
  const agents = new AgentManager(
    workspace,
    () => {
      /* No connected clients in this test. */
    },
    () => {
      /* No connected clients in this test. */
    },
    (cwd, handler, id) => {
      const provider = new TestAgentProvider(handler, id);
      provider.cwd = cwd;
      providers.push(provider);
      return provider;
    },
    registry,
  );
  const store = new ScheduleStore(join(directory, "schedules.sqlite"));
  let now = new Date("2026-09-16T12:00:00Z");
  let manager = new ScheduleManager(
    store,
    workspace,
    agents,
    registry,
    () => {
      /* No connected clients in this test. */
    },
    () => now,
  );
  const projectId = randomUUID();
  workspace.execute({
    type: "workspace.command",
    commandId: randomUUID(),
    epoch: workspace.snapshot().epoch,
    operation: { kind: "project.add", projectId, name: "App", directory },
  });
  cleanups.push(async () => {
    await manager.close();
    await agents.close();
    registry.close();
    workspace.close();
    await rm(directory, { recursive: true, force: true });
  });
  const definition: ScheduleDefinition = {
    name: "Review",
    projectId,
    prompt: "Review recent commits",
    enabled: true,
    target: { kind: "agent", provider: "codex", model: "fixture" },
    cadence: { kind: "interval", minutes: 60 },
  };
  const request = (operation: ScheduleOperation, requestId = randomUUID()) =>
    manager.request({ type: "schedule.request", requestId, operation });
  const create = (patch: Partial<ScheduleDefinition> = {}): AgentSchedule => {
    const result = request({ kind: "create", schedule: { ...definition, ...patch } });
    expect(result.outcome.status).toBe("ok");
    return manager.list()[0]!;
  };
  return {
    directory,
    workspace,
    agents,
    providers,
    registry,
    definition,
    request,
    create,
    get manager() {
      return manager;
    },
    setNow: (value: string) => {
      now = new Date(value);
    },
    restart: async () => {
      await manager.close();
      manager = new ScheduleManager(
        new ScheduleStore(join(directory, "schedules.sqlite")),
        workspace,
        agents,
        registry,
        () => {
          /* No connected clients in this test. */
        },
        () => now,
      );
    },
  };
}

it("runs without clients, selects the model, reuses the session and resumes it after its CLI stops", async () => {
  const f = await setup();
  f.create();
  f.setNow("2026-09-16T13:00:00Z");
  f.manager.tick();
  f.manager.tick();
  await expect.poll(() => f.workspace.agents()[0]?.status).toBe("done");
  f.manager.tick();
  const session = f.workspace.agents()[0]!;
  expect(session.model).toBe("fixture");
  expect(session.settings?.mode).toBe("default");
  expect(f.manager.list()[0]?.runs[0]?.status).toBe("done");
  expect(f.providers[0]?.requests.filter((r) => r.method === "turn/start")).toHaveLength(1);
  expect(f.workspace.snapshot().projects[0]?.tabs).toHaveLength(0);
  // No pane shows the finished run, so its CLI does not idle until the next one.
  await expect.poll(() => f.providers[0]?.closed).toBe(true);
  const open = await f.agents.request({
    type: "agent.request",
    requestId: randomUUID(),
    operation: { kind: "open-session", sessionId: session.id },
  });
  expect(open.outcome.status).toBe("ok");
  const again = await f.agents.request({
    type: "agent.request",
    requestId: randomUUID(),
    operation: { kind: "open-session", sessionId: session.id },
  });
  expect(again.outcome.status).toBe("ok");
  expect(f.workspace.snapshot().projects[0]?.tabs).toHaveLength(1);
  f.setNow("2026-09-16T14:00:00Z");
  f.manager.tick();
  await expect
    .poll(() => f.providers[1]?.requests.filter((r) => r.method === "turn/start").length)
    .toBe(1);
  expect(f.providers[1]?.requests.find((r) => r.method === "thread/resume")?.params).toMatchObject({
    threadId: session.threadId,
  });
  expect(f.workspace.agents()).toHaveLength(1);
});

it("keeps native tool approvals and does not stack runs while waiting for input", async () => {
  const f = await setup();
  const schedule = f.create({ prompt: "approve this command" });
  f.request({ kind: "run", id: schedule.id });
  await expect.poll(() => f.workspace.agents()[0]?.status).toBe("needs_input");
  f.manager.tick();
  expect(f.manager.list()[0]?.runs[0]?.status).toBe("needs_input");
  f.setNow("2026-09-16T13:00:00Z");
  f.manager.tick();
  expect(f.providers[0]?.requests.filter((r) => r.method === "turn/start")).toHaveLength(1);
  expect(f.manager.list()[0]?.nextRunAt).toBe("2026-09-16T14:00:00.000Z");
  expect(f.request({ kind: "run", id: schedule.id }).outcome.status).toBe("error");
});

it("records busy existing agents as skipped and rejects sessions from another workspace", async () => {
  const f = await setup();
  const info = await f.agents.startScheduled(
    randomUUID(),
    f.definition.projectId,
    "claude",
    "fixture-claude",
  );
  await f.agents.request({
    type: "agent.request",
    requestId: randomUUID(),
    operation: { kind: "send", sessionId: info.id, text: "hold" },
  });
  f.create({ target: { kind: "session", sessionId: info.id } });
  f.setNow("2026-09-16T13:00:00Z");
  f.manager.tick();
  expect(f.manager.list()[0]?.runs[0]).toMatchObject({
    status: "skipped",
    message: "Agent is busy or waiting for input",
  });
  expect(
    f.request({
      kind: "create",
      schedule: {
        ...f.definition,
        projectId: randomUUID(),
        target: { kind: "session", sessionId: info.id },
      },
    }).outcome.status,
  ).toBe("error");
});

it("persists pauses, enforces revision checks and makes manual runs retry-safe", async () => {
  const f = await setup();
  const schedule = f.create({ enabled: false });
  await f.restart();
  f.setNow("2026-09-17T12:00:00Z");
  f.manager.tick();
  expect(f.workspace.agents()).toHaveLength(0);
  expect(
    f.request({ kind: "update", id: schedule.id, expectedRevision: 100, schedule: f.definition })
      .outcome.status,
  ).toBe("error");
  const id = randomUUID();
  f.request({ kind: "run", id: schedule.id }, id);
  f.request({ kind: "run", id: schedule.id }, id);
  await expect.poll(() => f.workspace.agents()[0]?.status).toBe("done");
  f.manager.tick();
  expect(f.providers[0]?.requests.filter((r) => r.method === "turn/start")).toHaveLength(1);
  expect(f.manager.list()[0]?.runs).toHaveLength(1);
  expect(f.manager.list()[0]?.enabled).toBe(false);
  const latest = f.manager.list()[0]!;
  expect(
    f.request({ kind: "delete", id: latest.id, expectedRevision: latest.revision }).outcome.status,
  ).toBe("ok");
  expect(f.manager.list()).toHaveLength(0);
  expect(f.workspace.agents()).toHaveLength(1);
});

it("does not replay an active delivery or an overdue occurrence after restart", async () => {
  const f = await setup();
  const schedule = f.create({ prompt: "hold" });
  f.request({ kind: "run", id: schedule.id });
  await expect.poll(() => f.workspace.agents()[0]?.status).toBe("working");
  await f.restart();
  expect(f.manager.list()[0]?.runs[0]?.status).toBe("interrupted");
  f.setNow("2026-09-17T12:00:00Z");
  f.manager.tick();
  expect(f.manager.list()[0]?.runs[0]).toMatchObject({
    status: "skipped",
    message: expect.stringContaining("offline"),
  });
  expect(f.providers[0]?.requests.filter((r) => r.method === "turn/start")).toHaveLength(1);
});

it("reports missing folders and provider errors instead of silently dropping a run", async () => {
  const f = await setup();
  const schedule = f.create();
  vi.spyOn(f.agents, "startScheduled").mockRejectedValueOnce(new Error("Provider needs sign-in"));
  f.request({ kind: "run", id: schedule.id });
  await expect.poll(() => f.manager.list()[0]?.runs[0]?.status).toBe("failed");
  expect(f.manager.list()[0]?.runs[0]?.message).toBe("Provider needs sign-in");
});

/** A finished upload in staging, as a client leaves it before the schedule that uses it saves. */
async function staged(root: string, name: string, text: string): Promise<AgentUpload> {
  const uploadId = randomUUID();
  await mkdir(join(root, "uploads", uploadId), { recursive: true });
  await writeFile(join(root, "uploads", uploadId, name), text);
  return { uploadId, name, mime: "application/pdf", size: text.length };
}

it("keeps a schedule's files and sends every run its own copy of them", async () => {
  const f = await setup();
  const root = f.workspace.attachmentsDirectory;
  const resume = await staged(root, "resume.pdf", "my resume");
  const schedule = f.create({ files: [resume] });
  expect(schedule.files).toEqual([resume]);
  const kept = join(root, "schedules", schedule.id, resume.uploadId, "resume.pdf");
  expect(await readFile(kept, "utf8")).toBe("my resume");
  // Claimed out of staging, so the sweep of unsent uploads cannot take it.
  expect(existsSync(join(root, "uploads", resume.uploadId))).toBe(false);

  const sent = async (runs: number) => {
    // No client is connected to report the agent's state, so a tick settles each run.
    await expect
      .poll(() => {
        f.manager.tick();
        return f.manager.list()[0]?.runs.filter((r) => r.status === "done").length;
      })
      .toBe(runs);
    const starts = f.providers.flatMap((p) => p.requests.filter((r) => r.method === "turn/start"));
    return JSON.stringify(starts[runs - 1]?.params);
  };
  f.request({ kind: "run", id: schedule.id });
  const first = await sent(1);
  const sessionId = f.workspace.agents()[0]!.id;
  // The agent is told where its copy is, inside the chat, never the schedule's own file.
  expect(first).toContain('The user attached \\"resume.pdf\\"');
  // Paths as they appear inside the JSON, where Windows' backslashes are escaped.
  const inJson = (path: string) => JSON.stringify(path).slice(1, -1);
  expect(first).toContain(inJson(join(root, sessionId)));
  expect(first).not.toContain(inJson(join(root, "schedules")));
  // The run's message shows the file, as a chat message with an attachment would.
  const runId = f.manager.list()[0]!.runs[0]!.id;
  expect(f.workspace.agentItem(sessionId, `prompt:${runId}`)).toMatchObject({
    attachments: [{ name: "resume.pdf" }],
  });

  f.request({ kind: "run", id: schedule.id });
  await sent(2);
  const copies = (await readdir(join(root, sessionId))).filter((name) => name !== resume.uploadId);
  expect(copies).toHaveLength(2);
  expect(await readFile(kept, "utf8")).toBe("my resume");
});

it("edits keep, add and remove a schedule's files, and deleting it removes them", async () => {
  const f = await setup();
  const root = f.workspace.attachmentsDirectory;
  const resume = await staged(root, "resume.pdf", "my resume");
  const schedule = f.create({ files: [resume] });
  const directory = join(root, "schedules", schedule.id);
  const update = (
    patch: Partial<ScheduleDefinition>,
    source: "user" | "agent" = "user",
    current = f.manager.list()[0]!,
  ) => {
    const { name, projectId, prompt, target, cadence, enabled, files } = current;
    return f.manager.request(
      {
        type: "schedule.request",
        requestId: randomUUID(),
        operation: {
          kind: "update",
          id: current.id,
          expectedRevision: current.revision,
          schedule: { name, projectId, prompt, target, cadence, enabled, files, ...patch },
        },
      },
      source,
    );
  };

  // A client that predates files leaves them out, and that keeps them.
  expect(update({ files: undefined, prompt: "Find internships" }).outcome.status).toBe("ok");
  expect(f.manager.list()[0]?.files).toEqual([resume]);
  // An agent's change cannot attach or remove files; it cannot upload them.
  expect(update({ files: [] }, "agent").outcome.status).toBe("ok");
  expect(f.manager.list()[0]?.files).toEqual([resume]);

  const letter = await staged(root, "letter.pdf", "cover letter");
  expect(update({ files: [letter] }).outcome.status).toBe("ok");
  expect(f.manager.list()[0]?.files).toEqual([letter]);
  expect(await readdir(directory)).toEqual([letter.uploadId]);

  // A file that is gone fails the whole change, which saves nothing and moves nothing.
  const fresh = await staged(root, "notes.pdf", "notes");
  const gone: AgentUpload = { ...letter, uploadId: randomUUID(), name: "gone.pdf" };
  const failed = update({ files: [letter, fresh, gone] });
  expect(failed.outcome).toMatchObject({
    status: "error",
    message: "gone.pdf is no longer on this machine. Attach it again.",
  });
  expect(f.manager.list()[0]?.files).toEqual([letter]);
  expect(existsSync(join(root, "uploads", fresh.uploadId))).toBe(true);

  const current = f.manager.list()[0]!;
  expect(
    f.request({ kind: "delete", id: current.id, expectedRevision: current.revision }).outcome
      .status,
  ).toBe("ok");
  expect(existsSync(directory)).toBe(false);
});

it("an agent's new schedule carries no files and a missing file fails a run by name", async () => {
  const f = await setup();
  const root = f.workspace.attachmentsDirectory;
  const resume = await staged(root, "resume.pdf", "my resume");
  const created = f.manager.request(
    {
      type: "schedule.request",
      requestId: randomUUID(),
      operation: { kind: "create", schedule: { ...f.definition, files: [resume] } },
    },
    "agent",
  );
  expect(created.outcome.status).toBe("ok");
  expect(f.manager.list()[0]?.files).toEqual([]);
  expect(existsSync(join(root, "uploads", resume.uploadId))).toBe(true);

  const schedule = f.create({ files: [resume] });
  await rm(join(root, "schedules", schedule.id), { recursive: true });
  f.request({ kind: "run", id: schedule.id });
  await expect
    .poll(() => f.manager.list().find((s) => s.id === schedule.id)?.runs[0])
    .toMatchObject({
      status: "failed",
      message: "resume.pdf is no longer attached to this schedule.",
    });
});

it("agent scheduling tools share the registry, remain scoped, and reject browser requests", async () => {
  const f = await setup(),
    bridge = new ScheduleTools();
  await bridge.start(f.manager);
  cleanups.push(() => bridge.close());
  const agent = await f.agents.startScheduled(
    randomUUID(),
    f.definition.projectId,
    "codex",
    "fixture",
  );
  const context = bridge.context(agent),
    url = context.env?.CONCORS_SCHEDULE_URL;
  if (!url) throw new Error("Missing scheduling endpoint");
  const headers = {
    Authorization: `Bearer ${context.env?.CONCORS_SCHEDULE_TOKEN}`,
    "Content-Type": "application/json",
  };
  const request: ScheduleRequest = {
    type: "schedule.request",
    requestId: randomUUID(),
    operation: {
      kind: "create",
      schedule: { ...f.definition, target: { kind: "session", sessionId: agent.id } },
    },
  };
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(request) });
  expect(response.status).toBe(200);
  expect((await response.json()).outcome.status).toBe("ok");
  expect(f.manager.list()[0]).toMatchObject({ source: "agent", sessionId: agent.id });
  await fetch(url, { method: "POST", headers, body: JSON.stringify(request) });
  expect(f.manager.list()).toHaveLength(1);
  expect(
    (
      await fetch(url, {
        method: "POST",
        headers: { ...headers, Origin: "https://example.com" },
        body: JSON.stringify(request),
      })
    ).status,
  ).toBe(401);
  expect((await fetch(url, { method: "POST", body: JSON.stringify(request) })).status).toBe(401);
  const mcp = await fetch(url.replace("/schedules", "/mcp"), {
    method: "POST",
    headers: { ...headers, Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  expect(mcp.status).toBe(200);
  expect((await mcp.json()).result.tools[0].name).toBe("concors_schedules");
  const wrongScope = {
    ...request,
    requestId: randomUUID(),
    operation: { kind: "create", schedule: { ...f.definition, projectId: randomUUID() } },
  };
  expect(
    (await fetch(url, { method: "POST", headers, body: JSON.stringify(wrongScope) })).status,
  ).toBe(400);
});
