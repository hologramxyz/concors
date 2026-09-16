import { expect, it } from "vitest";
import {
  parseProcessStat,
  processLabel,
  listeningPorts,
  ProcessInventory,
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
