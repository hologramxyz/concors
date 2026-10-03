import { seedProject } from "./support/projects.ts";
import { test, expect } from "@playwright/test";
import { signedIn } from "./signed-in.ts";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page, Locator } from "@playwright/test";
import { chooseProvider } from "./support/agents.ts";

async function bounds(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("Expected a visible element");
  return rect;
}
async function project(page: Page) {
  const root = mkdtempSync(join(tmpdir(), "concors-file-ui-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "main.ts"), "export const answer = 42;\nconsole.log(answer);\n");
  writeFileSync(
    join(root, "README.md"),
    "# Project files\n\nOpen [the source](src/main.ts#L2).\n\n<script>window.bad = true</script>\n",
  );
  writeFileSync(join(root, "example.ts"), "const example = true;\n");
  await signedIn(page);
  await page.goto("/");
  await seedProject(page, "File browser test", root);
  await expect(page.getByRole("heading", { name: "File browser test", exact: true })).toBeVisible();
  return root;
}
async function openSource(page: Page) {
  await page.getByRole("button", { name: "Toggle project files" }).click();
  const tree = page.getByRole("complementary", { name: "Project files" });
  await tree.getByRole("button", { name: "src", exact: true }).click();
  await tree.getByRole("button", { name: "main.ts", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Code editor: src/main.ts" })).toBeVisible();
  return tree;
}

test("desktop reopens cached folders without another listing request", async ({ page }) => {
  let sourceRequests = 0;
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((raw) => socket.send(raw));
    socket.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      if (
        message.type === "file.request" &&
        message.operation.kind === "list" &&
        message.operation.path === "src"
      )
        sourceRequests++;
      server.send(raw);
    });
  });
  const root = await project(page);
  try {
    await page.getByRole("button", { name: "Toggle project files" }).click();
    const tree = page.getByRole("complementary", { name: "Project files" });
    const folder = tree.getByRole("button", { name: "src", exact: true });
    await folder.click();
    const main = tree.getByRole("button", { name: "main.ts", exact: true });
    await expect(main).toBeVisible();
    await folder.click();
    await folder.click();
    await expect(main).toBeVisible();
    await expect(tree.getByRole("list", { name: "src", exact: true })).toHaveAttribute(
      "aria-busy",
      "false",
    );
    expect(sourceRequests).toBe(1);
    await expect(tree.getByText("Loading files", { exact: false })).toHaveCount(0);
    writeFileSync(join(root, "src", "added.ts"), "export const added = true;\n");
    await tree.getByRole("button", { name: "Refresh file tree" }).click();
    await expect(tree.getByRole("button", { name: "added.ts", exact: true })).toBeVisible();
    expect(sourceRequests).toBe(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("copy reports unavailable clipboard access and recovers without page errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });
  const root = await project(page);
  try {
    await openSource(page);
    await page.getByRole("button", { name: "Copy file", exact: true }).click();
    const failed = page.getByRole("button", { name: "Copy failed; try again", exact: true });
    await expect(failed).toBeVisible();
    expect(errors).toEqual([]);

    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw new DOMException("Denied", "NotAllowedError");
          },
        },
      });
    });
    await failed.click();
    await expect(failed).toBeVisible();
    expect(errors).toEqual([]);

    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            sessionStorage.setItem("audit-clipboard", text);
          },
        },
      });
    });
    await failed.click();
    await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("audit-clipboard"))).toContain(
      "answer = 42",
    );

    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    });
    await page.getByRole("button", { name: "Copied", exact: true }).click();
    await expect(failed).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("file polling recovers read warnings without losing drafts or hiding failed saves", async ({
  page,
}) => {
  test.setTimeout(45_000);
  let failReads = false;
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (
        message.type === "file.request" &&
        message.operation.path === "src/main.ts" &&
        ((failReads && message.operation.kind === "read") || message.operation.kind === "write")
      ) {
        socket.send(
          JSON.stringify({
            type: "file.result",
            requestId: message.requestId,
            outcome: {
              status: "error",
              message:
                message.operation.kind === "write"
                  ? "Permission denied while saving"
                  : "The file is temporarily unavailable",
            },
          }),
        );
        return;
      }
      server.send(raw);
    });
  });
  const root = await project(page);
  try {
    await openSource(page);
    const code = page.getByRole("textbox", { name: "Code editor: src/main.ts" });
    await code.fill("my unsaved draft");
    failReads = true;
    await expect(page.getByRole("alert")).toContainText("The file is temporarily unavailable", {
      timeout: 10_000,
    });
    failReads = false;
    await expect(page.getByRole("alert")).toHaveCount(0, { timeout: 10_000 });
    await expect(code).toContainText("my unsaved draft");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Permission denied while saving");
    expect(readFileSync(join(root, "src/main.ts"), "utf8")).toContain("answer = 42");
    writeFileSync(join(root, "src/main.ts"), "An external edit after the failed save\n");
    await expect(
      page.getByText("This file changed on the machine. Your version is kept."),
    ).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("alert")).toContainText("Permission denied while saving");
    await expect(code).toContainText("my unsaved draft");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("browse, edit, preserve drafts across file tabs, preview Markdown and follow links", async ({
  page,
}) => {
  const root = await project(page);
  try {
    const tree = await openSource(page);
    const code = page.getByRole("textbox", { name: "Code editor: src/main.ts" });
    await code.fill("export const answer = 43;\nconsole.log(answer);\n");
    await tree.getByRole("button", { name: "README.md", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Project files" })).toBeVisible();
    await page.getByRole("link", { name: "the source" }).click();
    await expect(code).toContainText("43");
    await expect(page.getByRole("button", { name: /^main.ts/, pressed: true })).toHaveCount(1);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => readFileSync(join(root, "src/main.ts"), "utf8")).toContain("43");
    await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
    await code.fill("manual draft");
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Close src/main.ts file" }).click();
    await expect(code).toContainText("manual draft");
    await page.screenshot({ path: "test-results/files-desktop.png" });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Close src/main.ts file" }).click();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("agent edits produce a conflict and Vim saves use the file service", async ({ page }) => {
  const root = await project(page);
  try {
    await openSource(page);
    const code = page.getByRole("textbox", { name: "Code editor: src/main.ts" });
    await code.fill("my draft");
    writeFileSync(join(root, "src/main.ts"), "agent changed this");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText("This file changed on the machine. Your version is kept."),
    ).toBeVisible();
    expect(readFileSync(join(root, "src/main.ts"), "utf8")).toBe("agent changed this");
    await expect(code).toContainText("my draft");
    await page.getByRole("button", { name: "Compare with disk" }).click();
    await expect(page.getByText("agent changed this", { exact: true })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Keep my draft", exact: true }).click();
    await page.getByRole("button", { name: "Vim", exact: true }).click();
    await code.click();
    await page.keyboard.press("Escape");
    await page.keyboard.type(":w");
    await page.keyboard.press("Enter");
    await expect.poll(() => readFileSync(join(root, "src/main.ts"), "utf8")).toBe("my draft");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("file drawer and editor fit a narrow viewport", async ({ page }) => {
  const root = await project(page);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await openSource(page);
    await expect(page.getByRole("complementary", { name: "Project files" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Code editor: src/main.ts" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: "test-results/files-mobile.png" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("agent file links open Markdown and code tabs without leaving the workspace", async ({
  page,
}) => {
  const root = await project(page);
  try {
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await chooseProvider(page);
    await expect(page.getByLabel("Message Codex")).toBeEnabled();
    await page.getByLabel("Message Codex").fill("file-links");
    await page.getByLabel("Message Codex").press("Enter");
    await expect(page.getByText("the screenshot", { exact: true })).toHaveAttribute(
      "title",
      "Outside this project: /tmp/concors-shot.png",
    );
    await expect(page.getByRole("link", { name: "the screenshot" })).toHaveCount(0);
    await page.getByRole("link", { name: "the README", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Project files", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit source", exact: true }).click();
    const markdown = page.getByRole("textbox", { name: "Code editor: README.md" });
    await markdown.fill("# Edited readme\n");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(() => readFileSync(join(root, "README.md"), "utf8"))
      .toBe("# Edited readme\n");
    await page.getByRole("button", { name: "Tab 2", exact: true }).click();
    await page.getByRole("link", { name: "the code", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Code editor: src/main.ts" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("agent replies show the images they embed inline and open them full size", async ({
  page,
}) => {
  const root = await project(page);
  try {
    writeFileSync(
      join(root, "shot.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    await chooseProvider(page);
    await expect(page.getByLabel("Message Codex")).toBeEnabled();
    await page.getByLabel("Message Codex").fill("show-image");
    await page.getByLabel("Message Codex").press("Enter");
    const image = page.getByRole("button", { name: "Open The pricing page", exact: true });
    await expect(image).toHaveAttribute("data-inline-image", "ready");
    await expect(page.getByText("a missing one", { exact: true })).toHaveAttribute(
      "title",
      "Image not available: gone.png",
    );
    await image.click();
    await expect(page.getByRole("dialog", { name: "The pricing page" })).toBeVisible();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("files behave as a full-height resizable sidebar with readable type", async ({ page }) => {
  const root = await project(page);
  try {
    const toggle = page.getByRole("button", { name: "Toggle project files" });
    const before = await bounds(toggle);
    const tree = await openSource(page);
    await expect.poll(async () => Math.round((await bounds(tree)).width)).toBe(320);
    const rect = await bounds(tree);
    expect(rect.y).toBe(0);
    expect(rect.height).toBe(page.viewportSize()?.height);
    await expect.poll(async () => Math.round(before.x - (await bounds(toggle)).x)).toBe(320);
    const fontSize = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((node) => getComputedStyle(node).fontSize);
    expect(
      await tree
        .getByRole("button", { name: "src", exact: true })
        .evaluate((node) => getComputedStyle(node).fontSize),
    ).toBe("13px");
    expect(await fontSize('[aria-label="Project tabs"] button')).toBe("13px");
    expect(await fontSize(".cm-content")).toBe("14px");
    await page.screenshot({ path: "test-results/files-sidebar.png" });
    const handle = page.getByRole("separator", { name: "Resize files sidebar" });
    const grip = await bounds(handle);
    await page.mouse.move(grip.x + grip.width / 2, grip.y + 100);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 - 100, grip.y + 100, { steps: 8 });
    await page.mouse.up();
    await expect(handle).toHaveAttribute("aria-valuenow", "420");
    await handle.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(handle).toHaveAttribute("aria-valuenow", "436");
    await page.getByRole("button", { name: "Close files", exact: true }).click();
    await expect(tree).toHaveCount(0);
    await expect(toggle).toBeFocused();
    await toggle.click();
    await expect(handle).toHaveAttribute("aria-valuenow", "436");
    await expect(tree.getByRole("button", { name: "main.ts", exact: true })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("concors.files.sidebar-width")))
      .toBe("436");
    await page.reload();
    await toggle.click();
    await expect(handle).toHaveAttribute("aria-valuenow", "436");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await tree.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe("0s");
    await handle.press("Home");
    await expect(handle).toHaveAttribute("aria-valuenow", "240");
    await handle.dblclick();
    await expect(handle).toHaveAttribute("aria-valuenow", "320");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a slow editor download shows the file immediately instead of a loading-editor message", async ({
  page,
}) => {
  let release!: () => void;
  const download = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The editor's lazy chunk: its source module from a dev server, its hashed bundle from a build.
  await page.route(
    /\/(files\/code-editor\.tsx|assets\/code-editor-[\w-]+\.js)(\?.*)?$/,
    async (route) => {
      await download;
      await route.continue();
    },
  );
  const root = await project(page);
  try {
    await page.getByRole("button", { name: "Toggle project files" }).click();
    const tree = page.getByRole("complementary", { name: "Project files" });
    await tree.getByRole("button", { name: "src", exact: true }).click();
    await tree.getByRole("button", { name: "main.ts", exact: true }).click();
    await expect(page.getByLabel("Source of src/main.ts")).toContainText(
      "export const answer = 42;",
    );
    await expect(page.getByText("Loading editor…", { exact: true })).toHaveCount(0);
    release();
    await expect(page.getByRole("textbox", { name: "Code editor: src/main.ts" })).toBeVisible();
  } finally {
    release();
    rmSync(root, { recursive: true, force: true });
  }
});

test("file actions create entries, toggle hidden files and refresh expanded folders", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const root = await project(page);
  try {
    writeFileSync(join(root, ".env"), "EXAMPLE=demo\n");
    const tree = await openSource(page);
    const iconSize = (locator: Locator) =>
      locator.locator("svg").evaluate((icon) => getComputedStyle(icon).width);
    const expectedSize = await iconSize(page.getByRole("button", { name: "Toggle project files" }));
    for (const name of [
      "Close files",
      "New file",
      "New folder",
      "Show hidden files",
      "Refresh file tree",
    ]) {
      expect(await iconSize(tree.getByRole("button", { name, exact: true }))).toBe(expectedSize);
    }
    const close = await bounds(tree.getByRole("button", { name: "Close files" }));
    const actions = await bounds(tree.getByRole("group", { name: "File actions" }));
    expect(actions.y).toBeGreaterThanOrEqual(close.y + close.height);
    await expect(tree.getByText(root, { exact: true })).toHaveCount(0);
    await expect(tree.getByRole("button", { name: ".env", exact: true })).toHaveCount(0);
    await tree.getByRole("button", { name: "Show hidden files" }).click();
    await expect(tree.getByRole("button", { name: ".env", exact: true })).toBeVisible();
    await tree.getByRole("button", { name: "Hide hidden files" }).click();
    await expect(tree.getByRole("button", { name: ".env", exact: true })).toHaveCount(0);
    await tree.getByRole("button", { name: "New folder", exact: true }).click();
    await tree.getByLabel("New folder path").fill("notes");
    await tree.getByRole("button", { name: "Create", exact: true }).click();
    await expect(tree.getByRole("button", { name: "notes", exact: true })).toBeVisible();
    expect(statSync(join(root, "notes")).isDirectory()).toBe(true);
    await tree.getByRole("button", { name: "New file", exact: true }).click();
    await tree.getByLabel("New file path").fill("notes/new.ts");
    await tree.getByRole("button", { name: "Create", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Code editor: notes/new.ts" });
    await expect(editor).toBeVisible();
    await editor.fill("export const created = true;\n");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(() => readFileSync(join(root, "notes/new.ts"), "utf8"))
      .toContain("created = true");
    await expect(tree.getByRole("button", { name: "new.ts", exact: true })).toBeVisible();
    await tree.getByRole("button", { name: "New file", exact: true }).click();
    await tree.getByLabel("New file path").fill("notes/new.ts");
    await tree.getByRole("button", { name: "Create", exact: true }).click();
    await expect(tree.getByRole("alert")).toContainText("already exists");
    expect(readFileSync(join(root, "notes/new.ts"), "utf8")).toContain("created = true");
    await tree.getByRole("button", { name: "Cancel", exact: true }).click();
    writeFileSync(join(root, "src", "from-agent.ts"), "// new agent file\n");
    await tree.getByRole("button", { name: "Refresh file tree" }).click();
    await expect(tree.getByRole("button", { name: "from-agent.ts", exact: true })).toBeVisible();
    await expect(tree.getByRole("button", { name: "new.ts", exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/files-actions.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await tree.getByRole("button", { name: "New folder", exact: true }).click();
    await expect(tree.getByLabel("New folder path")).toBeVisible();
    expect(await tree.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: "test-results/files-actions-mobile.png" });
    await tree.getByLabel("New folder path").press("Escape");
    await expect(tree).toBeVisible();
    await expect(tree.getByLabel("Filter loaded files")).toBeFocused();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
