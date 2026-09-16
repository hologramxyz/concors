import { test, expect, signedIn } from "./signed-in.ts";
import type { Page } from "@playwright/test";
import type { MachineProcess, ResourceOperation, StorageEntry } from "@concors/protocol";

async function resources(page: Page, supported = true, processCount?: number) {
  await signedIn(page);
  const operations: ResourceOperation[] = [];
  let processes: MachineProcess[] = [
    {
      id: "10:100",
      pid: 10,
      parentPid: 1,
      name: "Test worker",
      directory: "/repo/feature",
      projectId: null,
      memoryBytes: 512 * 1024 ** 2,
      cpuPercent: 24,
      state: "running",
      ports: [],
      stopBlocked: null,
    },
    {
      id: "11:100",
      pid: 11,
      parentPid: 1,
      name: "Vite preview",
      directory: "/repo/main",
      projectId: null,
      memoryBytes: 256 * 1024 ** 2,
      cpuPercent: 2,
      state: "sleeping",
      ports: [5173],
      stopBlocked: null,
    },
    {
      id: "12:100",
      pid: 12,
      parentPid: 1,
      name: "Concors daemon",
      directory: "/repo/main",
      projectId: null,
      memoryBytes: 128 * 1024 ** 2,
      cpuPercent: 1,
      state: "sleeping",
      ports: [],
      stopBlocked: "Machine connection or daemon infrastructure is protected.",
    },
  ];
  if (processCount !== undefined) {
    const template = processes[0];
    if (!template) throw new Error("Missing process fixture");
    processes = Array.from({ length: processCount }, (_, index) => ({
      ...template,
      id: `${index + 100}:100`,
      pid: index + 100,
      name: `Worker ${index + 1}`,
    }));
  }
  let entries: StorageEntry[] = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      path: "/tmp/old-build",
      kind: "temporary",
      bytes: 100 * 1024 ** 2,
      modifiedAt: 1,
      memoryBacked: true,
      branch: null,
      cleanupBlocked: null,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      path: "/repo/dirty-worktree",
      kind: "worktree",
      bytes: 1024 ** 3,
      modifiedAt: 1,
      memoryBacked: false,
      branch: "feature",
      cleanupBlocked: "Contains modified, untracked, or ignored files.",
    },
  ];
  await page.routeWebSocket("ws://127.0.0.1:7429/ws", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const request = JSON.parse(String(raw));
      if (request.type !== "resource.request") {
        server.send(raw);
        return;
      }
      const operation: ResourceOperation = request.operation;
      operations.push(operation);
      const outcome =
        operation.kind === "processes"
          ? { status: "processes", snapshot: { sampledAt: Date.now(), processes, warnings: [] } }
          : operation.kind === "storage"
            ? {
                status: "storage",
                snapshot: { scannedAt: Date.now(), entries, volumes: [], warnings: [] },
              }
            : {
                status: "done",
                message:
                  operation.kind === "stop"
                    ? "Termination requested for this process only."
                    : "Removed /tmp/old-build. This deletion cannot be undone.",
              };
      if (operation.kind === "stop")
        processes = processes.filter((item) => item.id !== operation.id);
      if (operation.kind === "cleanup")
        entries = entries.filter((item) => item.id !== operation.id);
      socket.send(
        JSON.stringify({ type: "resource.result", requestId: request.requestId, outcome }),
      );
    });
    server.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (!supported && message.type === "daemon.ready")
        message.capabilities = message.capabilities.filter(
          (name: string) => name !== "machine-resources",
        );
      socket.send(JSON.stringify(message));
    });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Open resources" })).toBeVisible({
    timeout: 15_000,
  });
  return operations;
}

test("Resources is available through usage and processes, with explicit stop and cleanup review", async ({
  page,
}) => {
  const operations = await resources(page);
  const sidebar = page.getByRole("navigation", { name: "Primary" });
  await expect(sidebar.getByRole("button", { name: "Processes", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Manage processes" })).toHaveCount(0);
  const viewAll = sidebar.getByRole("button", { name: "View all processes", exact: true });
  await expect(viewAll).toHaveText("View all");
  await expect(viewAll.locator("svg")).toHaveCount(0);
  await expect(sidebar.locator('section[aria-label="Processes"] ul + button')).toHaveText(
    "View all",
  );
  await viewAll.hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await viewAll.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Resources", level: 2 })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("512.0 MiB RAM");
  const rows = page.getByRole("list", { name: "Running processes" });
  await expect(rows.locator("details[open]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop Test worker (PID 10)" })).toBeHidden();
  await rows.getByLabel("Details for Concors daemon (PID 12)", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop Concors daemon (PID 12)" })).toBeDisabled();
  await rows.getByLabel("Details for Test worker (PID 10)", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(rows).toContainText("/repo/feature");
  await page.getByRole("button", { name: "Stop Test worker (PID 10)" }).click();
  const stop = page.getByRole("dialog", { name: "Stop process?" });
  await expect(stop).toContainText("Child processes can remain");
  await stop.getByRole("button", { name: "Cancel" }).click();
  expect(operations.some((op) => op.kind === "stop")).toBe(false);
  await page.getByRole("button", { name: "Stop Test worker (PID 10)" }).click();
  await stop.getByRole("button", { name: "Stop process", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Termination requested");
  await page.getByRole("button", { name: "Storage & cleanup" }).click();
  expect(operations.some((op) => op.kind === "storage")).toBe(false);
  await page.getByRole("button", { name: "Scan storage" }).click();
  await expect(page.getByRole("main")).toContainText("RAM-backed");
  await expect(page.getByRole("main")).toContainText(
    "Contains modified, untracked, or ignored files.",
  );
  await page
    .getByRole("button", { name: "Review", exact: true })
    .filter({ visible: true })
    .last()
    .click();
  const cleanup = page.getByRole("dialog", { name: "Remove files?" });
  await expect(cleanup.getByRole("button", { name: "Remove permanently" })).toBeDisabled();
  await cleanup
    .getByRole("textbox", { name: "Type the full path to confirm" })
    .fill("/tmp/old-build");
  await cleanup.getByRole("button", { name: "Remove permanently" }).click();
  await expect(page.getByRole("status")).toContainText("cannot be undone");
  expect(operations).toContainEqual({
    kind: "cleanup",
    id: "11111111-1111-4111-8111-111111111111",
    confirmation: "/tmp/old-build",
  });
  await page.screenshot({ path: "test-results/resources-storage.png" });
});

test("preview links reject unsafe URLs and remain available in the sidebar", async ({
  page,
  context,
}) => {
  await resources(page);
  await context.route("https://preview.example/**", (route) =>
    route.fulfill({ body: "Preview fixture" }),
  );
  await page.getByRole("button", { name: "Open resources" }).click();
  await page.getByRole("main").getByRole("button", { name: ":5173", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Preview link" });
  await dialog.getByRole("textbox", { name: "Preview URL" }).fill("javascript:alert(1)");
  await expect(dialog.getByRole("button", { name: "Open preview" })).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Preview URL" }).fill("https://preview.example/");
  const opened = page.waitForEvent("popup");
  await dialog.getByRole("button", { name: "Open preview" }).click();
  const popup = await opened;
  await expect(popup).toHaveURL("https://preview.example/");
  await popup.close();
  const again = page.waitForEvent("popup");
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: /Vite preview/ })
    .click();
  const next = await again;
  await expect(next).toHaveURL("https://preview.example/");
  await next.close();
  await page.screenshot({ path: "test-results/resources-running.png" });
  const row = page
    .getByRole("list", { name: "Running processes" })
    .getByRole("listitem")
    .filter({ hasText: "Vite preview" });
  await row.getByLabel("Details for Vite preview (PID 11)", { exact: true }).click();
  await row.getByRole("button", { name: "Change preview link" }).click();
  await expect(dialog.getByRole("textbox", { name: "Preview URL" })).toHaveValue(
    "https://preview.example/",
  );
});

for (const count of [0, 1, 8]) {
  test(`sidebar keeps ${count} processes compact and offers View all only for multiple processes`, async ({
    page,
  }) => {
    await resources(page, true, count);
    const section = page.getByRole("region", { name: "Processes", exact: true });
    if (count) await expect(section.getByRole("listitem")).toHaveCount(Math.min(count, 6));
    else await expect(section).toContainText("No workspace processes discovered.");
    const viewAll = section.getByRole("button", { name: "View all processes" });
    if (count > 1) {
      await viewAll.click();
      await expect(
        page.getByRole("list", { name: "Running processes" }).getByRole("listitem"),
      ).toHaveCount(count);
      await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
      await expect(viewAll).toHaveCount(0);
    } else {
      await expect(viewAll).toHaveCount(0);
      await page.getByRole("button", { name: "Open resources" }).click();
      await expect(page.getByRole("heading", { name: "Resources", level: 2 })).toBeVisible();
    }
  });
}

test("older daemons show an upgrade state without unsupported requests", async ({ page }) => {
  const operations = await resources(page, false);
  await page.getByRole("button", { name: "Open resources" }).click();
  await expect(page.getByRole("alert")).toContainText("Update the machine daemon");
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
  expect(operations).toEqual([]);
});
