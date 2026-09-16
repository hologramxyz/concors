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

test("previews stay separate from the process inventory and Resources opens from the computer menu", async ({
  page,
}) => {
  const operations = await resources(page);
  const sidebar = page.getByRole("navigation", { name: "Primary" });
  await expect(sidebar.getByRole("button", { name: "Previews", exact: true })).toBeVisible();
  await expect(sidebar).toContainText("No previews yet.");
  await expect(sidebar.getByRole("button", { name: "Processes", exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "View all processes" })).toHaveCount(0);
  expect(operations).toEqual([]);
  await sidebar.getByRole("button", { name: "Switch machine" }).click();
  await page.getByRole("menuitem", { name: "Resources", exact: true }).click();
  const main = page.getByRole("main");
  const rows = main.getByRole("list", { name: "Running processes" });
  await expect(rows).toContainText("512.0 MiB RAM");
  await expect(rows).toContainText("Paseo Daemon");
  for (const name of ["Paseo Daemon", "Main thread", "Codex agent", "Vite preview"])
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

test("named previews open directly, reject unsafe links, and can be edited or removed without process inspection", async ({
  page,
  context,
}) => {
  const operations = await resources(page, false);
  await context.route("https://preview.example/**", (route) =>
    route.fulfill({ body: "Preview fixture" }),
  );
  const sidebar = page.getByRole("navigation", { name: "Primary" });
  await sidebar.getByRole("button", { name: "Add preview", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add preview", exact: true });
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Web app");
  await dialog.getByRole("textbox", { name: "Preview URL" }).fill("javascript:alert(1)");
  await expect(dialog.getByRole("button", { name: "Save preview" })).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Preview URL" }).fill("https://preview.example/");
  await dialog.getByRole("button", { name: "Save preview" }).click();
  const link = sidebar.getByRole("button", { name: "Open preview: Web app", exact: true });
  await link.hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  const opened = page.waitForEvent("popup");
  await link.click();
  const popup = await opened;
  await expect(popup).toHaveURL("https://preview.example/");
  await popup.close();
  expect(operations).toEqual([]);
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await link.hover();
  await expect(page.getByRole("tooltip", { name: /^Web app/ })).toBeVisible();
  const bounds = await link.boundingBox();
  expect(bounds?.width).toBe(32);
  expect(bounds?.height).toBe(32);
  await link.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit preview", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit preview", exact: true });
  await edit.getByRole("textbox", { name: "Name", exact: true }).fill("Feature preview");
  await edit.getByRole("button", { name: "Save preview" }).click();
  const renamed = sidebar.getByRole("button", {
    name: "Open preview: Feature preview",
    exact: true,
  });
  await renamed.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove preview", exact: true }).click();
  await expect(sidebar.getByRole("region", { name: "Previews", exact: true })).toHaveCount(0);
  expect(operations).toEqual([]);
});

test("only a deliberately attached process preview appears in the sidebar", async ({
  page,
  context,
}) => {
  await resources(page);
  await context.route("https://preview.example/**", (route) =>
    route.fulfill({ body: "Preview fixture" }),
  );
  await page.getByRole("button", { name: "Open resources" }).click();
  await page.getByRole("main").getByRole("button", { name: ":5173", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add preview", exact: true });
  await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Vite preview",
  );
  await dialog.getByRole("textbox", { name: "Preview URL" }).fill("https://preview.example/");
  await dialog.getByRole("button", { name: "Save preview" }).click();
  const sidebar = page.getByRole("navigation", { name: "Primary" });
  const previews = sidebar.getByRole("region", { name: "Previews", exact: true });
  await expect(previews.getByRole("listitem")).toHaveCount(1);
  await expect(previews).not.toContainText("RAM");
  await expect(previews).not.toContainText("Paseo");
  const opened = page.waitForEvent("popup");
  await previews.getByRole("button", { name: "Open preview: Vite preview", exact: true }).click();
  const popup = await opened;
  await expect(popup).toHaveURL("https://preview.example/");
  await popup.close();
  await page.screenshot({ path: "test-results/previews-sidebar.png" });
});

test("older daemons show an upgrade state without unsupported requests", async ({ page }) => {
  const operations = await resources(page, false);
  await page.getByRole("button", { name: "Open resources" }).click();
  await expect(page.getByRole("alert")).toContainText("Update the machine daemon");
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
  expect(operations).toEqual([]);
});
