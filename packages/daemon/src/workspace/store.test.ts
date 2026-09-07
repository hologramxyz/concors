import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { WorkspaceCommand } from "@concors/protocol";
import { describe, expect, it } from "vitest";
import { WorkspaceStore } from "./store.ts";

describe("workspace persistence", () => {
  it("persists machine identity, layout and command receipts across restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "concors-workspace-"));
    const path = join(directory, "workspace.sqlite");
    let store = new WorkspaceStore(path);
    try {
      const original = store.snapshot();
      const command: WorkspaceCommand = {
        type: "workspace.command",
        commandId: randomUUID(),
        epoch: original.epoch,
        operation: {
          kind: "project.add",
          projectId: randomUUID(),
          name: "Concors",
          directory: "/concors",
        },
      };
      const accepted = store.execute(command);
      store.close();
      store = new WorkspaceStore(path);
      expect(store.snapshot()).toEqual(accepted.snapshot);
      expect(store.snapshot().machineId).toBe(original.machineId);
      const retry = store.execute(command);
      expect(retry.result).toEqual(accepted.result);
      expect(retry.changed).toBe(false);
      expect(retry.snapshot.revision).toBe(1);
      const collision = store.execute({
        ...command,
        operation: {
          ...command.operation,
          kind: "project.add",
          projectId: randomUUID(),
          name: "Other",
          directory: "/other",
        },
      });
      expect(collision.result.outcome).toMatchObject({
        status: "rejected",
        code: "INVALID_OPERATION",
      });
      expect(store.snapshot().projects).toHaveLength(1);
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects an old epoch without mutating state and remembers the rejection", () => {
    const store = new WorkspaceStore();
    try {
      const command: WorkspaceCommand = {
        type: "workspace.command",
        commandId: randomUUID(),
        epoch: randomUUID(),
        operation: {
          kind: "project.add",
          projectId: randomUUID(),
          name: "Wrong epoch",
          directory: "/wrong",
        },
      };
      const result = store.execute(command);
      expect(result.result.outcome).toMatchObject({ status: "rejected", code: "CONFLICT" });
      expect(store.snapshot().revision).toBe(0);
      expect(store.execute(command).result).toEqual(result.result);
    } finally {
      store.close();
    }
  });

  it("rolls back state when writing the command receipt fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "concors-workspace-"));
    const path = join(directory, "workspace.sqlite");
    const store = new WorkspaceStore(path);
    const db = new DatabaseSync(path);
    try {
      db.exec(
        "CREATE TRIGGER fail_receipt BEFORE INSERT ON commands BEGIN SELECT RAISE(ABORT, 'disk failure simulation'); END",
      );
      expect(() =>
        store.execute({
          type: "workspace.command",
          commandId: randomUUID(),
          epoch: store.snapshot().epoch,
          operation: {
            kind: "project.add",
            projectId: randomUUID(),
            name: "Atomic",
            directory: "/atomic",
          },
        }),
      ).toThrow("disk failure simulation");
      expect(store.snapshot().revision).toBe(0);
      expect(store.snapshot().projects).toHaveLength(0);
    } finally {
      db.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
