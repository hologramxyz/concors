import type { ResourceRequest, ResourceResult } from "@concors/protocol";
import type { WorkspaceStore } from "../workspace/store.ts";
import { basename, dirname, join } from "node:path";
import { ProcessInventory } from "./processes.ts";
import { PreviewNames } from "./preview-names.ts";

export class MachineResources {
  readonly processes: ProcessInventory;
  constructor(workspace: WorkspaceStore) {
    const projects = () => workspace.snapshot().projects;
    const attachments = workspace.attachmentsDirectory;
    this.processes = new ProcessInventory(
      projects,
      new PreviewNames(
        basename(attachments) === "attachments"
          ? join(dirname(attachments), "preview-names.json")
          : attachments + "-preview-names.json",
      ),
    );
  }
  async request(request: ResourceRequest): Promise<ResourceResult> {
    let outcome: ResourceResult["outcome"];
    try {
      const operation = request.operation;
      switch (operation.kind) {
        case "processes":
          outcome = { status: "processes", snapshot: await this.processes.snapshot() };
          break;
        case "rename-preview":
          await this.processes.renamePreview(operation.id, operation.port, operation.name);
          outcome = { status: "done", message: "Preview renamed." };
          break;
        case "stop":
          await this.processes.stop(operation.id);
          outcome = {
            status: "done",
            message:
              "Termination requested for this process only. Child processes may remain; refresh to check. No force-kill was sent.",
          };
          break;
      }
    } catch (error) {
      outcome = {
        status: "error",
        message:
          error instanceof Error ? error.message.slice(0, 1000) : "Resource operation failed.",
      };
    }
    return { type: "resource.result", requestId: request.requestId, outcome };
  }
}
