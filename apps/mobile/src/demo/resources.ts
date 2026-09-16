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
      stopBlocked: null,
    },
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
          warnings: ["Demo · All resource readings and actions are simulated."],
        },
      };
    else {
      processes = processes.filter((item) => item.id !== operation.id);
      outcome = { status: "done", message: "Demo process stopped. No real process was affected." };
    }
    return { type: "resource.result", requestId: request.requestId, outcome };
  };
}
