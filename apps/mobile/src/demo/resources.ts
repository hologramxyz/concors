import type {
  MachineProcess,
  ResourceRequest,
  ResourceResult,
  StorageEntry,
} from "@concors/protocol";
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
  let entries: StorageEntry[] = [
    {
      id: "aaaaaaaa-1111-4111-8111-111111111111",
      kind: "temporary",
      path: "/tmp/demo-build",
      bytes: 128 * 1024 ** 2,
      modifiedAt: 1,
      memoryBacked: true,
      branch: null,
      cleanupBlocked: null,
    },
    {
      id: "bbbbbbbb-1111-4111-8111-111111111111",
      kind: "worktree",
      path: "/home/demo/concors",
      bytes: 512 * 1024 ** 2,
      modifiedAt: 1,
      memoryBacked: false,
      branch: "main",
      cleanupBlocked: "An open workspace uses this path.",
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
    else if (operation.kind === "storage")
      outcome = {
        status: "storage",
        snapshot: {
          scannedAt: Date.now(),
          entries,
          volumes: [
            {
              path: "/home/demo",
              totalBytes: 80 * 1024 ** 3,
              availableBytes: 32 * 1024 ** 3,
              memoryBacked: false,
            },
          ],
          warnings: ["Demo · No real files are scanned or removed."],
        },
      };
    else if (operation.kind === "stop") {
      processes = processes.filter((item) => item.id !== operation.id);
      outcome = { status: "done", message: "Demo process stopped. No real process was affected." };
    } else {
      const entry = entries.find((item) => item.id === operation.id);
      if (!entry || entry.cleanupBlocked || entry.path !== operation.confirmation)
        outcome = { status: "error", message: "Review and confirm an eligible demo entry." };
      else {
        entries = entries.filter((item) => item.id !== operation.id);
        outcome = { status: "done", message: "Demo entry removed. No real files were deleted." };
      }
    }
    return { type: "resource.result", requestId: request.requestId, outcome };
  };
}
