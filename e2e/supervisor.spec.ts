import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "../packages/daemon-client/src/index.ts";
import { test, expect, signedIn } from "./signed-in.ts";
import { chooseProvider } from "./support/agents.ts";
import { mockDictation } from "./support/dictation.ts";
import { reportNonMac } from "./support/platform.ts";
import { seedProject } from "./support/projects.ts";

test("Supervisor uses the unified chat and retains its selected harness after navigation and reload", async ({
  page,
}) => {
  test.setTimeout(60000);
  await signedIn(page, undefined, undefined, { supervisorLanding: true });
  await page.goto("/");
  await expect(page.getByTestId("supervisor-page")).toBeVisible();
  await chooseProvider(page);
  await page
    .getByRole("textbox", { name: "Message Codex", exact: true })
    .fill("Find context across my workspaces");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Hello from");
  await page.screenshot({ path: test.info().outputPath("supervisor-desktop.png") });
  await page.getByRole("button", { name: "Agent and model", exact: true }).click();
  await page.getByRole("button", { name: "Back to providers", exact: true }).click();
  await page.getByRole("option", { name: /^Claude Code( |$)/ }).click();
  await page.getByRole("option").first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start new conversation", exact: true })
    .click();
  await expect(page.getByTestId("supervisor-page")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message Claude Code", exact: true })
    .fill("Coordinate two projects");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Coordinate two projects");
  await page.getByRole("button", { name: "Schedules", exact: true }).click();
  await page.getByRole("button", { name: "Supervisor", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Message Claude Code", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("supervisor-page")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message Claude Code", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Agent and model", exact: true }).click();
  await page.getByRole("button", { name: "Back to providers", exact: true }).click();
  await page.getByRole("option", { name: /^Codex( |$)/ }).click();
  await page.getByRole("option").first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Switch to Codex", exact: true })
    .click();
  await expect(page.getByRole("log")).toContainText("Find context across my workspaces");
  await expect(page.getByRole("log")).not.toContainText("Coordinate two projects");
  // Verify the restored session can continue. Supervisor survives workspace cleanup, so leave
  // Codex as the most recently used harness for the following specs on this shared daemon.
  await page
    .getByRole("textbox", { name: "Message Codex", exact: true })
    .fill("Continue the original conversation");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Continue the original conversation");
  await expect(page.getByRole("log").getByText("Hello from Codex", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("Escape stops the Supervisor's running turn and the dictation shortcut works in its composer", async ({
  page,
  context,
}) => {
  await reportNonMac(context);
  await mockDictation(page);
  await signedIn(page, undefined, undefined, { supervisorLanding: true });
  await page.goto("/");
  const supervisor = page.getByTestId("supervisor-page");
  await expect(supervisor).toBeVisible();
  await chooseProvider(page);
  const composer = supervisor.getByRole("textbox", { name: "Message Codex", exact: true });
  const interrupt = supervisor.getByRole("button", { name: "Interrupt agent", exact: true });
  try {
    await composer.fill("hold this Supervisor turn");
    await composer.press("Enter");
    await expect(interrupt).toBeEnabled();
    await composer.fill("Unsent draft");
    await page.keyboard.press("Escape");
    await expect(interrupt).toHaveCount(0);
    await expect(composer).toHaveValue("Unsent draft");
    await composer.focus();
    await page.keyboard.press("Control+d");
    await expect(supervisor.getByRole("group", { name: "Dictation", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(supervisor.getByRole("group", { name: "Dictation" })).toHaveCount(0);
    await expect(composer).toHaveValue("Unsent draft");
    await composer.fill("");
  } finally {
    // The Supervisor outlives each spec's cleanup; a turn left holding would refuse the next one.
    if (await interrupt.count()) await interrupt.click();
  }
});

test("a file the Supervisor names inside an open workspace opens in that workspace", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-supervisor-files-"));
  await mkdir(join(directory, "notes"));
  await mkdir(join(directory, "src"));
  await writeFile(join(directory, "notes", "plan.md"), "# Release plan\n");
  await writeFile(join(directory, "src", "main.ts"), "export const answer = 42;\n");
  // The fixture agent always says the same thing, so its reply is rewritten on the way in, both
  // as it streams and as the chat reads it back when it is shown again.
  const reply = `See [the plan](${directory}/notes/plan.md), then ${directory}/src/main.ts:1. Not [the readme](README.md) or /tmp/elsewhere.png.`;
  const rewritten = new Set<string>();
  let armed = false;
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      const items: { id: string; kind: string; text: string }[] =
        message.type === "agent.item"
          ? [message.item]
          : (message.outcome?.conversation?.items ?? []);
      for (const item of items) {
        if (armed && message.type === "agent.item" && item.kind === "assistant")
          rewritten.add(item.id);
        if (rewritten.has(item.id)) item.text = reply;
      }
      socket.send(JSON.stringify(message));
    });
  });
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Supervisor files", directory);
    await page.getByRole("button", { name: "Supervisor", exact: true }).click();
    const supervisor = page.getByTestId("supervisor-page");
    await chooseProvider(page);
    armed = true;
    const composer = supervisor.getByRole("textbox", { name: "Message Codex", exact: true });
    await composer.fill("Where is the release plan?");
    await composer.press("Enter");
    const plan = supervisor.getByRole("link", { name: "the plan", exact: true });
    await expect(plan).toBeVisible();
    armed = false;
    // Neither a relative link nor a path outside every workspace has anywhere to open.
    await expect(supervisor.getByRole("link", { name: "the readme" })).toHaveCount(0);
    await expect(supervisor.getByText("the readme", { exact: true })).toHaveAttribute(
      "title",
      "Outside this project: README.md",
    );
    await expect(supervisor.getByRole("link", { name: "/tmp/elsewhere.png" })).toHaveCount(0);
    await plan.click();
    await expect(supervisor).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Supervisor files", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "File notes/plan.md" })).toContainText(
      "Release plan",
    );
    // A path named in plain text opens the same way.
    await page.getByRole("button", { name: "Supervisor", exact: true }).click();
    await supervisor.getByRole("link", { name: `${directory}/src/main.ts:1`, exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Code editor: src/main.ts" })).toBeVisible();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the sidebar marks the Supervisor while it works, waits for an answer, or has news", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const control = new DaemonConnection({
    endpoint: describeDaemonEndpoint("ws://127.0.0.1:7429/ws"),
    client: { kind: "test", name: "supervisor marks", version: "0.0.0" },
  });
  const off = control.subscribeWorkspace(() => undefined);
  const sessionId = () =>
    control.workspace?.supervisor?.tabs[0]?.nodes.find((node) => node.kind === "pane")?.sessionId ??
    "";
  try {
    await control.connect();
    await signedIn(page, undefined, undefined, { supervisorLanding: true });
    await page.goto("/");
    const supervisor = page.getByTestId("supervisor-page");
    await expect(supervisor).toBeVisible();
    await chooseProvider(page);
    await expect(supervisor.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    await expect.poll(sessionId).not.toBe("");
    const send = async (text: string) => {
      const result = await control.requestAgent(
        { kind: "send", sessionId: sessionId(), text },
        crypto.randomUUID(),
      );
      expect(result.outcome.status).toBe("ok");
    };
    const nav = page.getByRole("button", { name: "Supervisor", exact: true });
    const mark = nav.locator("[data-row-state]");
    const schedules = page.getByRole("button", { name: "Schedules", exact: true });
    await expect(mark).toHaveCount(0);

    await schedules.click();
    await send("hold this while I look elsewhere");
    await expect(nav.getByRole("img", { name: "Agent status: Working" })).toHaveAttribute(
      "data-row-state",
      "working",
    );
    await nav.click();
    await supervisor.getByRole("button", { name: "Interrupt agent", exact: true }).click();
    await expect(mark).toHaveCount(0);

    await schedules.click();
    await send("question");
    await expect(nav.getByRole("img", { name: "Agent status: Needs input" })).toHaveAttribute(
      "data-row-state",
      "attention",
    );
    await page.screenshot({ path: test.info().outputPath("supervisor-needs-input-mark.png") });
    await nav.click();
    // A question keeps its mark while it is open, until it is answered.
    await expect(mark).toHaveAttribute("data-row-state", "attention");
    await supervisor.getByRole("radio", { name: "Blue Use blue", exact: true }).click();
    await supervisor.getByRole("button", { name: "Submit answer", exact: true }).click();
    await expect(mark).toHaveCount(0);

    await schedules.click();
    await send("finish while I look elsewhere");
    await expect(nav.getByRole("img", { name: "Agent status: Done" })).toHaveAttribute(
      "data-row-state",
      "done",
    );
    await nav.click();
    await expect(supervisor.getByRole("log")).toContainText("finish while I look elsewhere");
    await expect(mark).toHaveCount(0);
  } finally {
    // The Supervisor outlives each spec's cleanup; a turn left going would refuse the next one.
    const agent = control.agents.find((item) => item.id === sessionId());
    if (agent?.turnId && ["working", "needs_input"].includes(agent.status))
      await control.requestAgent(
        { kind: "interrupt", sessionId: agent.id, turnId: agent.turnId },
        crypto.randomUUID(),
      );
    off();
    control.disconnect();
  }
});

test("the Supervisor's MCP servers open from its title bar, as a chat's do from its pane", async ({
  page,
}) => {
  await signedIn(page, undefined, undefined, { supervisorLanding: true });
  await page.goto("/");
  await expect(page.getByTestId("supervisor-page")).toBeVisible();
  await chooseProvider(page);
  await expect(page.getByRole("textbox", { name: "Message Codex", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Supervisor actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "MCP servers…" }).click();
  const status = page.getByRole("list", { name: "MCP server status" });
  await expect(status.getByRole("listitem")).toHaveText([
    /Concors schedules \(built in\)\s*Connected/,
    /github\s*Needs sign-in/,
  ]);
  await expect(status.getByRole("button", { name: "Sign in to github" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(status).toHaveCount(0);
  // Elsewhere the title bar has no Supervisor menu.
  await page.getByRole("button", { name: "Schedules", exact: true }).click();
  await expect(page.getByRole("button", { name: "Supervisor actions" })).toHaveCount(0);
});
