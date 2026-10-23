import { test, expect, signedIn } from "./signed-in.ts";
import type { Page } from "@playwright/test";
import type { MachineProcess, ResourceOperation } from "@concors/protocol";

async function resources(page: Page, supported = true) {
  await signedIn(page);
  const operations: ResourceOperation[] = [];
  const template: MachineProcess = {
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
    previews: [],
    stopBlocked: null,
  };
  let processes: MachineProcess[] = [
    template,
    {
      ...template,
      id: "11:100",
      pid: 11,
      name: "Vite preview",
      directory: "/repo/main",
      memoryBytes: 256 * 1024 ** 2,
      cpuPercent: 2,
      state: "sleeping",
      ports: [5173],
      previews: [{ port: 5173, protocol: "http" }],
      startedAt: Date.now() - 2 * 3_600_000,
      swapBytes: 0,
    },
    // A dev server an agent left behind weeks ago, pushed almost entirely into swap.
    {
      ...template,
      id: "16:100",
      pid: 16,
      name: "next-server",
      directory: "/repo/site",
      memoryBytes: 40 * 1024 ** 2,
      cpuPercent: 0,
      state: "sleeping",
      ports: [3000],
      previews: [{ port: 3000, protocol: "http" }],
      startedAt: Date.now() - 22 * 86_400_000,
      swapBytes: Math.round(2.3 * 1024 ** 3),
    },
    {
      ...template,
      id: "12:100",
      pid: 12,
      name: "Concors daemon",
      stopBlocked: "Machine connection or daemon infrastructure is protected.",
    },
    { ...template, id: "13:100", pid: 13, name: "Paseo Daemon", ports: [7420] },
    { ...template, id: "14:100", pid: 14, name: "Main thread" },
    { ...template, id: "15:100", pid: 15, name: "Codex agent" },
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
      if (operation.kind === "stop")
        processes = processes.filter((item) => item.id !== operation.id);
      socket.send(
        JSON.stringify({
          type: "resource.result",
          requestId: request.requestId,
          outcome:
            operation.kind === "processes"
              ? {
                  status: "processes",
                  snapshot: { sampledAt: Date.now(), processes, warnings: [] },
                }
              : { status: "done", message: "Termination requested for this process only." },
        }),
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

test("detected previews stay separate from the process inventory and Resources opens from the computer menu", async ({
  page,
}) => {
  const operations = await resources(page);
  const sidebar = page.getByRole("navigation", { name: "Primary" });
  await expect(sidebar.getByRole("button", { name: "Previews", exact: true })).toBeVisible();
  await expect(
    sidebar.getByRole("button", { name: "Open preview: Vite preview", exact: true }),
  ).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Processes", exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "View all processes" })).toHaveCount(0);
  expect(operations.some((operation) => operation.kind === "processes")).toBe(true);
  await sidebar.getByRole("button", { name: "Switch machine" }).click();
  await page.getByRole("menuitem", { name: "Resources", exact: true }).click();
  const main = page.getByRole("main");
  const rows = main.getByRole("list", { name: "Running processes" });
  await expect(rows).toContainText("512.0 MiB RAM");
  await expect(rows).toContainText("Paseo Daemon");
  for (const name of ["Paseo Daemon", "Main thread", "Codex agent"])
    await expect(sidebar).not.toContainText(name);
  await expect(main.getByRole("button", { name: "Storage & cleanup" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Scan storage" })).toHaveCount(0);
  await expect(rows.locator("details[open]")).toHaveCount(0);
  await rows.getByLabel("Details for Concors daemon (PID 12)", { exact: true }).click();
  await expect(rows.getByRole("button", { name: "Stop Concors daemon (PID 12)" })).toBeDisabled();
  await rows.getByLabel("Details for Test worker (PID 10)", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await rows.getByRole("button", { name: "Stop Test worker (PID 10)" }).click();
  const stop = page.getByRole("dialog", { name: "Stop process?" });
  await expect(stop).toContainText("Child processes can remain");
  await stop.getByRole("button", { name: "Cancel" }).click();
  expect(operations.some((op) => op.kind === "stop")).toBe(false);
  await rows.getByRole("button", { name: "Stop Test worker (PID 10)" }).click();
  await stop.getByRole("button", { name: "Stop process", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Termination requested");
  await page.screenshot({ path: "test-results/resources-processes.png" });
});

test("detected previews stop from the sidebar after a confirmation", async ({ page }) => {
  const operations = await resources(page);
  const sidebar = page.getByRole("navigation", { name: "Primary" });
  await sidebar.getByRole("button", { name: "Open preview: Vite preview", exact: true }).hover();
  await sidebar.getByRole("button", { name: "Stop Vite preview", exact: true }).click();
  const stop = page.getByRole("dialog", { name: "Stop process?" });
  await expect(stop).toContainText("Vite preview · PID 11");
  await stop.getByRole("button", { name: "Cancel" }).click();
  expect(operations.some((op) => op.kind === "stop")).toBe(false);
  await sidebar.getByRole("button", { name: "Stop Vite preview", exact: true }).click();
  await stop.getByRole("button", { name: "Stop process", exact: true }).click();
  await expect(stop).toHaveCount(0);
  expect(operations).toContainEqual({ kind: "stop", id: "11:100" });
  await expect(
    sidebar.getByRole("button", { name: "Open preview: Vite preview", exact: true }),
  ).toHaveCount(0);
});

test("automatically detected previews open directly, say how long they ran and what they hold, and have no manual controls", async ({
  page,
  context,
}) => {
  const operations = await resources(page);
  await context.route("http://127.0.0.1:5173/**", (route) =>
    route.fulfill({ body: "Preview fixture" }),
  );
  const sidebar = page.getByRole("navigation", { name: "Primary" });
  await expect(sidebar.getByRole("button", { name: "Add preview" })).toHaveCount(0);
  const link = sidebar.getByRole("button", { name: "Open preview: Vite preview", exact: true });
  await link.hover();
  const tooltip = page.getByRole("tooltip", { name: /^Vite preview/ });
  await expect(tooltip).toContainText("Running for 2 hours");
  await expect(tooltip).toContainText("256.0 MiB of memory");
  // A recent, light preview is not flagged; only the stale one is.
  await expect(sidebar.locator("[data-preview-warning]")).toHaveCount(1);
  const opened = page.waitForEvent("popup");
  await link.click();
  const popup = await opened;
  await expect(popup).toHaveURL("http://127.0.0.1:5173/");
  await popup.close();
  expect(operations.some((operation) => operation.kind === "processes")).toBe(true);
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await link.hover();
  await expect(page.getByRole("tooltip", { name: /^Vite preview/ })).toBeVisible();
  const bounds = await link.boundingBox();
  expect(bounds?.width).toBe(32);
  expect(bounds?.height).toBe(32);
  await link.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: /preview/i })).toHaveCount(0);
  await page.screenshot({ path: "test-results/previews-sidebar.png" });
});

test("Resources opens the same automatically detected preview without an editor", async ({
  page,
}) => {
  await resources(page);
  await page.getByRole("button", { name: "Open resources" }).click();
  await expect(page.getByRole("dialog", { name: /preview/i })).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("button", { name: "Preview" })).toHaveCount(2);
});

test("older daemons show an upgrade state without unsupported requests", async ({ page }) => {
  const operations = await resources(page, false);
  await page.getByRole("button", { name: "Open resources" }).click();
  await expect(page.getByRole("alert")).toContainText("Update the machine daemon");
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
  expect(operations).toEqual([]);
});

test("a preview left running for days, or holding a lot of memory, is flagged with why", async ({
  page,
}) => {
  await resources(page);
  const sidebar = page.getByRole("navigation", { name: "Primary" });
  // RAM alone (40 MiB) would hide it: the memory it holds counts its swap.
  const warning = sidebar.getByRole("img", {
    name: "Running for 22 days and holding 2.3 GiB of memory, most of it in swap. Stop it if you no longer need it.",
    exact: true,
  });
  await expect(warning).toBeVisible();
  await warning.hover();
  await expect(page.getByRole("tooltip")).toContainText("Running for 22 days");
  await page.screenshot({ path: test.info().outputPath("preview-warning.png") });
  // Nothing stops it but the person: the usual Stop is still theirs to press.
  await expect(
    sidebar.getByRole("button", { name: "Stop next-server", exact: true }),
  ).toBeEnabled();
});
