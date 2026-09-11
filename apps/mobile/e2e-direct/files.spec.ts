import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonConnection, describeDaemonEndpoint } from "@concors/daemon-client";
import { swipe } from "../e2e/support/swipe";

async function setup(page: Page, projectName = "Mobile file test") {
  const root = await mkdtemp(join(tmpdir(), "concors-mobile-files-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/main.ts"), "export const answer = 42;\nconsole.log(answer);\n");
  await writeFile(
    join(root, "README.md"),
    "# Mobile project files\n\nOpen [the source](src/main.ts#L2).\n",
  );
  await writeFile(join(root, ".hidden"), "private fixture\n");
  const desktop = new DaemonConnection({
    endpoint: describeDaemonEndpoint("ws://127.0.0.1:7440/ws"),
    client: { kind: "desktop", name: "mobile-file-control", version: "0.1.0" },
  });
  const off = desktop.subscribeWorkspace(() => undefined);
  await desktop.connect();
  await expect.poll(() => desktop.workspace?.machineId).toBeTruthy();
  const snapshot = desktop.workspace;
  if (!snapshot) throw new Error("Daemon workspace was not received");
  const projectId = crypto.randomUUID(),
    tabId = crypto.randomUUID(),
    paneId = crypto.randomUUID();
  const execute = async (
    operation: Parameters<DaemonConnection["executeWorkspace"]>[0]["operation"],
  ) => {
    const result = await desktop.executeWorkspace({
      type: "workspace.command",
      commandId: crypto.randomUUID(),
      epoch: snapshot.epoch,
      operation,
    });
    expect(result.outcome.status).toBe("accepted");
  };
  await execute({ kind: "project.add", projectId, name: projectName, directory: root });
  const project = desktop.workspace?.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Test project was not created");
  await execute({
    kind: "tab.create",
    projectId,
    expectedVersion: project.version,
    tabId,
    paneId,
    name: "File review",
    profile: "chat",
  });
  await page.goto(
    `/session?machineId=${snapshot.machineId}&projectId=${projectId}&tabId=${tabId}&paneId=${paneId}`,
  );
  await page.getByRole("button", { name: "Connect to desktop", exact: true }).click();
  await page.getByRole("button", { name: "Allow AI data sharing", exact: true }).click();
  const ui = page.frameLocator('iframe[title="Concors workspace"]');
  await ui.getByRole("button", { name: "Codex", exact: true }).click();
  await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
  return {
    root,
    desktop,
    ui,
    tabId,
    paneId,
    cleanup: async () => {
      desktop.disconnect();
      off();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("Files keeps shared glass controls and an icon-free directory breadcrumb in tree and editor views", async ({
  page,
}) => {
  const projectName = "A long project directory name that must fit comfortably on a small phone";
  const { ui, cleanup } = await setup(page, projectName);
  try {
    const toggle = ui.getByRole("button", { name: "Project files", exact: true });
    const chatStyle = await toggle.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        blur: style.backdropFilter,
        radius: style.borderRadius,
      };
    });
    await toggle.click();
    const files = ui.getByRole("region", { name: "Project files", exact: true });
    const header = files.locator(".mobile-files-header");
    const back = header.getByRole("button", { name: "Back to chat" });
    const directory = header.getByRole("button", { name: "Browse project directory" });
    await expect(header.getByRole("button")).toHaveCount(2);
    await expect(header.locator(".mobile-glass")).toHaveCount(2);
    await expect(header.locator("svg")).toHaveCount(1);
    await expect(directory).toContainText(projectName);
    await expect(directory).toHaveAttribute("aria-current", "page");
    await expect(back).toHaveCSS("border-radius", chatStyle.radius);
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 700 });
      for (const control of [back, directory]) {
        await expect(control).toHaveCSS("background-color", chatStyle.background);
        await expect(control).toHaveCSS("backdrop-filter", chatStyle.blur);
        await expect(control).toHaveCSS("height", "48px");
      }
      expect(await header.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        false,
      );
    }
    await files.getByRole("button", { name: "src", exact: true }).click();
    await files.getByRole("button", { name: "main.ts", exact: true }).click();
    const code = files.getByRole("textbox", { name: "Code editor: src/main.ts" });
    await expect(code).toContainText("42");
    await expect(directory).not.toHaveAttribute("aria-current", "page");
    await code.fill("Unsaved draft stays here when I browse the directory");
    const radius = await directory.evaluate((element) => getComputedStyle(element).borderRadius);
    const box = await directory.boundingBox();
    if (!box) throw new Error("Files directory breadcrumb is missing");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(directory).toHaveCSS("border-radius", radius);
    await expect(directory).toHaveCSS("background-color", chatStyle.background);
    await page.mouse.up();
    await expect(files.getByRole("button", { name: "main.ts", exact: true })).toBeVisible();
    await expect(directory).toHaveAttribute("aria-current", "page");
    await files
      .getByRole("navigation", { name: "Open files" })
      .getByRole("button", { name: /^main.ts/ })
      .click();
    await expect(code).toContainText("Unsaved draft stays here");
    // The title is also a swipe handle; dragging it must not activate its directory action.
    await page.setViewportSize({ width: 390, height: 700 });
    await swipe(page, { x: 90, y: 30 }, { x: 350, y: 30 });
    await expect(ui.locator(".mobile-files")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 390, 0)");
    await swipe(page, { x: 350, y: 240 }, { x: 35, y: 240 });
    await expect(code).toContainText("Unsaved draft stays here");
    await expect(directory).not.toHaveAttribute("aria-current", "page");
    await page.screenshot({
      path: "apps/mobile/test-results/direct/mobile-files-glass.png",
      animations: "disabled",
    });
    await page.emulateMedia({ forcedColors: "active" });
    await expect(back).toHaveCSS("backdrop-filter", "none");
    await expect(directory).toHaveCSS("backdrop-filter", "none");
  } finally {
    await cleanup();
  }
});

test("terminal taps and horizontal swipes open real files and the sidebar without losing the session", async ({
  page,
}) => {
  const { ui, desktop, tabId, paneId, cleanup } = await setup(page);
  try {
    const chat = ui.getByRole("textbox", { name: "Message Codex" });
    await chat.fill("Keep my chat draft during terminal gestures");
    const picker = ui.getByRole("combobox", { name: "Tabs and panes" });
    await picker.click();
    await ui.getByRole("button", { name: "Actions for tab File review", exact: true }).click();
    await ui.getByRole("menuitem", { name: "Add pane to this tab", exact: true }).click();
    await ui
      .getByRole("dialog", { name: "Add pane", exact: true })
      .getByRole("button", { name: "Terminal", exact: true })
      .click();
    const terminal = ui.getByLabel("Terminal output", { exact: true });
    await expect(terminal).toBeVisible();
    await terminal.tap();
    await page.keyboard.type("printf 'gesture-%s\\n' terminal-ready");
    await page.keyboard.press("Enter");
    await expect(terminal).toContainText("gesture-terminal-ready");
    const selection = await picker.getAttribute("data-value");
    if (!selection) throw new Error("Terminal pane is not selected");
    const terminalSession = () => {
      const node = desktop.workspace?.projects
        .flatMap((project) => project.tabs)
        .find((tab) => tab.id === tabId)
        ?.nodes.find((node) => node.id === selection.split(":")[1]);
      return node?.kind === "pane" ? node.sessionId : null;
    };
    const terminalId = terminalSession();
    expect(terminalId).toBeTruthy();
    const shell = ui.locator(".mobile-shell");
    const files = ui.getByRole("region", { name: "Project files", exact: true });
    const closed = () =>
      expect(ui.locator(".mobile-files")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 390, 0)");
    // The icon works while a terminal is focused, too.
    await ui.getByRole("button", { name: "Project files", exact: true }).tap();
    await expect(files.getByRole("button", { name: "README.md", exact: true })).toBeVisible();
    await files.getByRole("button", { name: "Back to chat" }).tap();
    await closed();
    // Start in xterm's actual screen, not the chat or the surrounding header.
    const screen = await terminal.locator(".xterm-screen").boundingBox();
    if (!screen) throw new Error("Terminal screen is missing");
    const y = screen.y + Math.min(180, screen.height / 2);
    await swipe(page, { x: 170, y }, { x: 173, y: y + 180 });
    await expect(shell).toHaveAttribute("data-files-open", "false");
    await expect(shell).toHaveAttribute("data-sidebar-open", "false");
    await swipe(page, { x: 335, y }, { x: 55, y });
    await expect(files.getByRole("button", { name: "README.md", exact: true })).toBeVisible();
    await expect(shell).toHaveAttribute("data-sidebar-open", "false");
    await swipe(page, { x: 70, y: 30 }, { x: 320, y: 30 });
    await closed();
    await swipe(page, { x: 55, y }, { x: 335, y });
    await expect(shell).toHaveAttribute("data-sidebar-open", "true");
    await expect(shell).toHaveAttribute("data-files-open", "false");
    await swipe(page, { x: 200, y: 240 }, { x: 30, y: 240 });
    await expect(shell).toHaveAttribute("data-sidebar-open", "false");
    await expect(picker).toHaveAttribute("data-value", selection);
    expect(terminalSession()).toBe(terminalId);
    expect(desktop.terminals.find((session) => session.id === terminalId)?.status).toBe("running");
    // A real tap still focuses xterm and accepts input after gesture navigation.
    await terminal.tap();
    await page.keyboard.type("printf 'gesture-%s\\n' still-connected");
    await page.keyboard.press("Enter");
    await expect(terminal).toContainText("gesture-still-connected");
    await picker.click();
    await ui.locator(`[data-pane-choice][data-value="${tabId}:${paneId}"]`).click();
    await expect(chat).toHaveValue("Keep my chat draft during terminal gestures");
  } finally {
    await cleanup();
  }
});

test("Files explains an older daemon without sending unsupported file requests", async ({
  page,
}) => {
  let fileRequests = 0;
  await page.routeWebSocket("ws://localhost:7440/ws", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((raw) => {
      const message = JSON.parse(raw.toString()) as { type: string; capabilities?: string[] };
      if (message.type === "daemon.ready") {
        message.capabilities = message.capabilities?.filter(
          (item) => !item.startsWith("project-file"),
        );
        socket.send(JSON.stringify(message));
      } else socket.send(raw);
    });
    socket.onMessage((raw) => {
      if ((JSON.parse(raw.toString()) as { type: string }).type === "file.request") fileRequests++;
      server.send(raw);
    });
  });
  const { ui, cleanup } = await setup(page);
  try {
    await ui.getByRole("button", { name: "Project files", exact: true }).tap();
    const files = ui.getByRole("region", { name: "Project files", exact: true });
    await expect(files.getByRole("status")).toContainText("File access needs a newer daemon");
    await expect(files.getByRole("status")).toContainText("Updating the mobile app alone");
    await expect(files.getByRole("button", { name: "README.md", exact: true })).toHaveCount(0);
    await files.getByRole("button", { name: "Back to chat" }).tap();
    await expect(ui.getByRole("textbox", { name: "Message Codex" })).toBeEnabled();
    expect(fileRequests).toBe(0);
  } finally {
    await cleanup();
  }
});

test("real mobile files preserve drafts, save explicitly and resolve competing disk edits", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { ui, root, desktop, cleanup } = await setup(page);
  try {
    const chat = ui.getByRole("textbox", { name: "Message Codex" });
    await chat.fill("Keep this chat draft while I inspect files");
    const agentId = desktop.agents[0]?.id;
    await ui.getByRole("button", { name: "Project files", exact: true }).click();
    const files = ui.getByRole("region", { name: "Project files", exact: true });
    await expect(files.getByRole("button", { name: "src", exact: true })).toBeVisible();
    expect(await files.evaluate((el) => el.ownerDocument.activeElement?.tagName)).toBe("BUTTON");
    await files.getByRole("button", { name: "src", exact: true }).click();
    await files.getByRole("button", { name: "main.ts", exact: true }).click();
    const code = files.getByRole("textbox", { name: "Code editor: src/main.ts" });
    const unloadGuardActive = () =>
      page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });
    await expect(code).toContainText("42");
    await code.fill("export const answer = 43;\n");
    expect(await readFile(join(root, "src/main.ts"), "utf8")).toContain("42");
    await files.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => readFile(join(root, "src/main.ts"), "utf8")).toContain("43");
    await expect.poll(unloadGuardActive).toBe(false);
    await code.fill("my unsaved file draft");
    await expect.poll(unloadGuardActive).toBe(true);
    await files.getByRole("button", { name: "Back to chat" }).click();
    await expect(chat).toHaveValue("Keep this chat draft while I inspect files");
    expect(desktop.agents[0]?.id).toBe(agentId);
    await ui.getByRole("button", { name: "Project files", exact: true }).click();
    await files
      .getByRole("navigation", { name: "Open files" })
      .getByRole("button", { name: /^main.ts/ })
      .click();
    await expect(code).toContainText("my unsaved file draft");
    await files.getByRole("button", { name: "Close src/main.ts file" }).click();
    const confirm = ui.getByRole("dialog", { name: "Unsaved file changes", exact: true });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(code).toContainText("my unsaved file draft");
    await writeFile(join(root, "src/main.ts"), "an agent changed this file\n");
    await files.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      files.getByText("This file changed on the machine. Your version is kept."),
    ).toBeVisible();
    expect(await readFile(join(root, "src/main.ts"), "utf8")).toBe("an agent changed this file\n");
    await files.getByRole("button", { name: "Compare with disk" }).click();
    await expect(files.getByText("an agent changed this file", { exact: true })).toBeVisible();
    await files.getByRole("button", { name: "Keep my draft", exact: true }).click();
    await confirm.getByRole("button", { name: "Continue", exact: true }).click();
    await files.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(() => readFile(join(root, "src/main.ts"), "utf8"))
      .toBe("my unsaved file draft");
    await code.fill("Draft retained during connection retry");
    await files.getByRole("button", { name: "Back to chat" }).click();
    await ui.getByRole("button", { name: "Open sidebar", exact: true }).click();
    await ui.getByRole("button", { name: "Account: Desktop connection", exact: true }).click();
    await ui
      .getByRole("dialog", { name: "Account", exact: true })
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    const settings = ui.getByRole("dialog", { name: "Settings", exact: true });
    await settings.getByRole("button", { name: "Reconnect", exact: true }).click();
    await settings.getByRole("button", { name: "Disconnect desktop", exact: true }).click();
    await expect(confirm).toContainText("Discard unsaved file changes and disconnect?");
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    await ui.getByRole("button", { name: "Project files", exact: true }).click();
    await files
      .getByRole("navigation", { name: "Open files" })
      .getByRole("button", { name: /^main.ts/ })
      .click();
    await expect(code).toContainText("Draft retained during connection retry");
    await files.getByRole("button", { name: "File options" }).click();
    await ui.getByRole("menuitem", { name: "Find in file" }).click();
    await expect(files.getByRole("textbox", { name: "Find", exact: true })).toBeVisible();
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 700 });
      expect(await files.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
    }
    await files.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(() => readFile(join(root, "src/main.ts"), "utf8"))
      .toBe("Draft retained during connection retry");
    expect(errors).toEqual([]);
    await page.screenshot({
      path: "apps/mobile/test-results/direct/mobile-file-editor.png",
      animations: "disabled",
    });
  } finally {
    await cleanup();
  }
});

test("mobile file browsing supports Markdown links, safe creation, hidden files and opposing swipes", async ({
  page,
}) => {
  const { ui, root, cleanup } = await setup(page);
  try {
    const client = await page.context().newCDPSession(page);
    const swipe = async (from: number, to: number, y = 250) => {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: from, y }],
      });
      for (let step = 1; step <= 10; step++)
        await client.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: from + ((to - from) * step) / 10, y }],
        });
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await swipe(350, 35);
    await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-files-open", "true");
    const files = ui.getByRole("region", { name: "Project files", exact: true });
    await expect(files.getByRole("button", { name: "README.md", exact: true })).toBeVisible();
    await files.getByRole("button", { name: "README.md", exact: true }).click();
    await expect(files.getByRole("heading", { name: "Mobile project files" })).toBeVisible();
    await files.getByRole("link", { name: "the source", exact: true }).click();
    await expect(
      files.getByRole("textbox", { name: "Code editor: src/main.ts" }),
    ).not.toBeFocused();
    await expect(files.getByRole("textbox", { name: "Code editor: src/main.ts" })).toContainText(
      "42",
    );
    await expect(
      files
        .getByRole("navigation", { name: "Open files" })
        .getByRole("button", { name: /^main.ts/ }),
    ).toHaveCount(1);
    await files.getByRole("button", { name: "Browse project directory" }).click();
    await expect(files.getByRole("button", { name: ".hidden", exact: true })).toHaveCount(0);
    await files.getByRole("button", { name: "Show hidden files" }).click();
    await expect(files.getByRole("button", { name: ".hidden", exact: true })).toBeVisible();
    await files.getByRole("button", { name: "New folder", exact: true }).click();
    await files.getByRole("textbox", { name: "New folder path" }).fill("notes");
    await files.getByRole("button", { name: "Create", exact: true }).click();
    await expect(files.getByRole("button", { name: "notes", exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await files.getByRole("button", { name: "New file", exact: true }).click();
    await files.getByRole("textbox", { name: "New file path" }).fill("notes/review.md");
    await files.getByRole("button", { name: "Create", exact: true }).click();
    await expect(files.getByRole("button", { name: "Edit source", exact: true })).toBeVisible();
    expect(await readFile(join(root, "notes/review.md"), "utf8")).toBe("");
    await files.getByRole("button", { name: "Browse project directory" }).click();
    await files.getByRole("button", { name: "Refresh file tree" }).click();
    await expect(files.getByRole("button", { name: "notes", exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await files.getByRole("button", { name: "New file", exact: true }).click();
    await files.getByRole("textbox", { name: "New file path" }).fill("src/main.ts");
    await files.getByRole("button", { name: "Create", exact: true }).click();
    await expect(files.getByRole("alert")).toBeVisible();
    expect(await readFile(join(root, "src/main.ts"), "utf8")).toContain("42");
    await files.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.screenshot({
      path: "apps/mobile/test-results/direct/mobile-file-tree.png",
      animations: "disabled",
    });
    await swipe(80, 320, 30);
    await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-files-open", "false");
    await swipe(30, 330);
    await expect(ui.locator(".mobile-shell")).toHaveAttribute("data-sidebar-open", "true");
  } finally {
    await cleanup();
  }
});
