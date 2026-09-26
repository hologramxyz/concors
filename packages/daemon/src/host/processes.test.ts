import { expect, it } from "vitest";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { environmentPreviewName, PreviewNames } from "./preview-names.ts";
import {
  parseProcessStat,
  processLabel,
  listeningPorts,
  ProcessInventory,
  previewProtocol,
  within,
} from "./processes.ts";

it("parses proc names containing spaces and parentheses without shifting identity fields", () => {
  const fields = Array<string>(22).fill("0");
  fields[0] = "S";
  fields[1] = "40";
  fields[11] = "20";
  fields[12] = "30";
  fields[19] = "987";
  expect(parseProcessStat(`41 (a (worker)) ${fields.join(" ")}`)).toMatchObject({
    pid: 41,
    parentPid: 40,
    ticks: 50,
    started: "987",
    name: "a (worker)",
  });
  expect(() => parseProcessStat("broken")).toThrow();
});
it("does not expose command arguments or environment secrets in process labels", () => {
  expect(
    processLabel("node", ["node", "/repo/node_modules/vite/bin/vite.js", "--token=secret"]),
  ).toBe("node · vite.js");
  expect(processLabel("node", ["node", "--eval", "secret"])).toBe("node");
  // Node renames its main thread; the executable still says what the server is.
  expect(processLabel("MainThread", ["/usr/bin/node", "/repo/node_modules/.bin/vite"])).toBe(
    "node · vite",
  );
  expect(processLabel("MainThread", ["node", "--watch", "secret"])).toBe("node");
  expect(processLabel("MainThread", ["python3", "-m", "http.server"])).toBe("python3");
});
it("reads only an agent's preview name from a server's environment", () => {
  expect(
    environmentPreviewName("PATH=/bin\0CONCORS_PREVIEW_NAME=  Pricing\tsite \0TOKEN=secret"),
  ).toBe("Pricing site");
  expect(environmentPreviewName("CONCORS_PREVIEW_NAME=\0TOKEN=secret")).toBeUndefined();
  expect(environmentPreviewName("X_CONCORS_PREVIEW_NAME=Nope")).toBeUndefined();
});
it("remembers preview names per directory and port across restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "concors-preview-names-"));
  try {
    const path = join(directory, "preview-names.json");
    const names = new PreviewNames(path);
    names.set("/repo/landing", 5173, " Landing ");
    names.set("/repo/docs", 5173, "Docs");
    expect(new PreviewNames(path).get("/repo/landing", 5173)).toBe("Landing");
    expect(new PreviewNames(path).get("/repo/landing", 3000)).toBeUndefined();
    names.set("/repo/landing", 5173, "  ");
    expect(new PreviewNames(path).get("/repo/landing", 5173)).toBeUndefined();
    expect(new PreviewNames(path).get("/repo/docs", 5173)).toBe("Docs");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("maps listening ports only to explicitly reported PIDs", () => {
  const ports = listeningPorts(
    'LISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=42,fd=20))\nLISTEN 0 128 [::]:3000 [::]:* users:(("node",pid=43,fd=10))',
  );
  expect(ports.get(42)).toEqual([5173]);
  expect(ports.get(43)).toEqual([3000]);
});
it("matches path boundaries rather than similar prefixes", () => {
  expect(within("/repo2", "/repo")).toBe(false);
  expect(within("/repo/a", "/repo")).toBe(true);
});
it("discovers browser previews without promoting JSON APIs", async () => {
  let browserContent = true;
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": browserContent ? "text/html; charset=utf-8" : "application/json",
    });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not listen");
  try {
    await expect(previewProtocol(address.port)).resolves.toBe("http");
    browserContent = false;
    await expect(previewProtocol(address.port)).resolves.toBeNull();
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
it("asks for the page when HEAD does not say what it serves", async () => {
  let head: "untyped" | "unsupported" = "untyped",
    page = "text/html";
  const methods: string[] = [];
  const server = createServer((request, response) => {
    methods.push(request.method ?? "");
    // React Router's dev server answers HEAD with 200 and no content type.
    if (request.method === "HEAD") response.writeHead(head === "untyped" ? 200 : 405);
    else response.writeHead(200, { "content-type": page });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not listen");
  try {
    await expect(previewProtocol(address.port)).resolves.toBe("http");
    expect(methods).toEqual(["HEAD", "GET"]);
    head = "unsupported";
    await expect(previewProtocol(address.port)).resolves.toBe("http");
    page = "application/json";
    await expect(previewProtocol(address.port)).resolves.toBeNull();
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
it.skipIf(process.platform !== "linux")(
  "names a preview from its server's environment until the person renames it",
  async () => {
    const server = spawn(
      process.execPath,
      [
        "-e",
        `require("node:http").createServer((q, r) => { r.writeHead(200, { "content-type": "text/html" }); r.end(); }).listen(0, "127.0.0.1", function () { console.log(this.address().port); });`,
      ],
      { env: { ...process.env, CONCORS_PREVIEW_NAME: "Pricing site" }, stdio: "pipe" },
    );
    try {
      const port = Number(
        await new Promise<string>((resolve) =>
          server.stdout.once("data", (data) => resolve(String(data))),
        ),
      );
      const inventory = new ProcessInventory(() => []);
      const preview = async () => {
        const snapshot = await inventory.snapshot(true);
        const item = snapshot.processes.find((p) => p.pid === server.pid);
        return { id: item?.id ?? "", preview: item?.previews.find((p) => p.port === port) };
      };
      await expect.poll(async () => (await preview()).preview?.name).toBe("Pricing site");
      const { id } = await preview();
      await inventory.renamePreview(id, port, "Landing");
      expect((await preview()).preview?.name).toBe("Landing");
      await inventory.renamePreview(id, port, "");
      expect((await preview()).preview?.name).toBe("Pricing site");
    } finally {
      server.kill();
    }
  },
  15_000,
);
it.skipIf(process.platform !== "linux")(
  "protects this daemon and rejects a stale process identity",
  async () => {
    const inventory = new ProcessInventory(() => []);
    const snapshot = await inventory.snapshot();
    const self = snapshot.processes.find((item) => item.pid === process.pid)!;
    expect(self.stopBlocked).toBeTruthy();
    await expect(inventory.stop(self.id)).rejects.toThrow("protected");
    await expect(inventory.stop(`${process.pid}:0`)).rejects.toThrow("exited or changed");
  },
  15_000,
);
