import type { MachineProcess, ResourceRequest, ResourceResult } from "@concors/protocol";
import { ids } from "./fixtures";

/** Simulated resource operations never reach the host filesystem or process table. */
export function demoResources() {
  let processes: MachineProcess[] = [
    {
      id: "101:1",
      pid: 101,
      parentPid: 1,
      name: "Dev server",
      directory: "/home/demo/concors",
      projectId: ids.project,
      cpuPercent: 3,
      memoryBytes: 256 * 1024 ** 2,
      state: "sleeping",
      ports: [5173],
      previews: [{ port: 5173, protocol: "http" }],
      stopBlocked: null,
    },
    {
      id: "102:1",
      pid: 102,
      parentPid: 1,
      name: "Test runner",
      directory: "/home/demo/concors",
      projectId: ids.project,
      cpuPercent: 24,
      memoryBytes: 512 * 1024 ** 2,
      state: "running",
      ports: [],
      previews: [],
      stopBlocked: null,
    },
    // What a working machine runs besides: agents, browsers they drive, helpers.
    ...(
      [
        ["claude", 308, 0.5],
        ["node · cli.js", 235, 0.5],
        ["chrome-headless", 218, 1.1],
        ["codex", 196, 0.2],
        ["chrome-headless", 112, 2.1],
        ["node · vite", 98, 0.8],
        ["chrome-headless", 82, 0],
        ["postgres", 64, 0.1],
        ["node · login-viewer.mjs", 58, 0.2],
        ["chrome-headless", 42, 0],
        ["redis-server", 18, 0.1],
        ["sshd", 9, 0],
      ] as const
    ).map(([name, mib, cpu], index): MachineProcess => ({
      id: `${200 + index}:1`,
      pid: 200 + index,
      parentPid: 1,
      name,
      directory: index % 3 ? "/home/demo/concors" : "/home/demo",
      projectId: index % 3 ? ids.project : null,
      cpuPercent: cpu,
      memoryBytes: mib * 1024 ** 2,
      state: cpu ? "running" : "sleeping",
      ports: [],
      previews: [],
      stopBlocked: null,
    })),
  ];
  return (request: ResourceRequest): ResourceResult => {
    const operation = request.operation;
    let outcome: ResourceResult["outcome"];
    if (operation.kind === "processes")
      outcome = {
        status: "processes",
        snapshot: {
          sampledAt: Date.now(),
          processes,
          warnings: ["Resource readings in this demo are simulated."],
        },
      };
    else {
      processes = processes.filter((item) => item.id !== operation.id);
      outcome = { status: "done", message: "Demo process stopped. No real process was affected." };
    }
    return { type: "resource.result", requestId: request.requestId, outcome };
  };
}
