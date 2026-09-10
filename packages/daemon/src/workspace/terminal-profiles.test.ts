import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { WorkspaceOperationSchema, type WorkspaceOperation } from "@concors/protocol";
import { WorkspaceStore } from "./store.ts";

it("persists profiles and launch snapshots without overwriting concurrent edits or changing open panes", () => {
  const dir = mkdtempSync(join(tmpdir(), "concors-saved-profiles-"));
  const file = join(dir, "workspace.sqlite");
  let store = new WorkspaceStore(file);
  const edit = (operation: WorkspaceOperation) => {
    const command = {
      type: "workspace.command" as const,
      commandId: randomUUID(),
      epoch: store.snapshot().epoch,
      operation,
    };
    const result = store.execute(command);
    expect(result.result.outcome.status).toBe("accepted");
    expect(store.execute(command).changed).toBe(false);
    return result.snapshot;
  };
  try {
    const profile = {
      id: randomUUID(),
      name: "Dev",
      command: "npm",
      args: ["run", "dev", "two words"],
    };
    edit({ kind: "terminal-profile.save", profile, expectedVersion: null });
    const projectId = randomUUID(),
      tabId = randomUUID(),
      paneId = randomUUID();
    edit({ kind: "project.add", projectId, name: "Code", directory: dir });
    edit({
      kind: "tab.create",
      projectId,
      expectedVersion: 0,
      tabId,
      paneId,
      name: "Dev",
      profile: "shell",
      terminalProfileId: profile.id,
    });
    const original = store.snapshot().projects[0]?.tabs[0]?.nodes[0];
    expect(original).toMatchObject({ terminalProfile: { ...profile, version: 0 } });
    edit({
      kind: "terminal-profile.save",
      profile: { ...profile, args: ["run", "test"] },
      expectedVersion: 0,
    });
    expect(store.snapshot().projects[0]?.tabs[0]?.nodes[0]).toEqual(original);
    const stale = store.execute({
      type: "workspace.command",
      commandId: randomUUID(),
      epoch: store.snapshot().epoch,
      operation: { kind: "terminal-profile.save", profile, expectedVersion: 0 },
    });
    expect(stale.result.outcome).toMatchObject({ status: "rejected", code: "CONFLICT" });
    const snapshot = store.snapshot();
    store.close();
    store = new WorkspaceStore(file);
    expect(store.snapshot()).toEqual(snapshot);
    expect(store.snapshot().terminalProfiles).toHaveLength(4);
    edit({ kind: "terminal-profile.remove", profileId: profile.id, expectedVersion: 1 });
    const split = edit({
      kind: "pane.split",
      projectId,
      expectedVersion: 1,
      tabId,
      paneId,
      newPaneId: randomUUID(),
      splitId: randomUUID(),
      axis: "horizontal",
      profile: "shell",
    });
    expect(split.projects[0]?.tabs[0]?.nodes.at(-1)).toMatchObject({
      terminalProfile: { ...profile, version: 0 },
    });
    const plain = edit({
      kind: "pane.configure",
      projectId,
      expectedVersion: 2,
      tabId,
      paneId,
      profile: "shell",
    });
    expect(plain.projects[0]?.tabs[0]?.nodes[0]).not.toHaveProperty("terminalProfile");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("rejects invalid command fields before accepting workspace commands", () => {
  const base = {
    kind: "terminal-profile.save",
    expectedVersion: null,
    profile: { id: randomUUID(), name: "Test", command: "node", args: [] },
  };
  for (const command of ["", "   ", "node\0bad", "node\nother"])
    expect(
      WorkspaceOperationSchema.safeParse({ ...base, profile: { ...base.profile, command } })
        .success,
    ).toBe(false);
  expect(
    WorkspaceOperationSchema.safeParse({
      ...base,
      profile: { ...base.profile, args: ["bad\0arg"] },
    }).success,
  ).toBe(false);
});
