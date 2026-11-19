import { describe, expect, it } from "vitest";
import type { LayoutNode } from "@concors/protocol";
import { paneTransfer } from "./pane-transfer";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const chat: Extract<LayoutNode, { kind: "pane" }> = {
  id: id(1),
  kind: "pane",
  profile: "chat",
  sessionId: id(2),
};
const shell = { ...chat, profile: "shell" as const };
const split = { project: { id: id(3), version: 4 }, tab: { id: id(5), root: id(6) }, pane: chat };
const options = {
  acrossWorkspaces: true,
  scheduled: false,
  ids: { splitId: id(7), tabId: id(8) },
};
const base = {
  kind: "pane.transfer",
  projectId: id(3),
  expectedVersion: 4,
  tabId: id(5),
  paneId: id(1),
  splitId: id(7),
};

describe("moving a pane", () => {
  it("joins a tab of another workspace, or opens a tab of its own there", () => {
    expect(paneTransfer(split, { projectId: id(9), tabId: id(0) }, options)).toEqual({
      ...base,
      targetTabId: id(0),
      targetProjectId: id(9),
    });
    expect(paneTransfer(split, { projectId: id(9) }, options)).toEqual({
      ...base,
      targetTabId: id(8),
      targetProjectId: id(9),
      newTab: true,
    });
  });

  it("joins another tab of its own workspace the way older daemons understand", () => {
    expect(
      paneTransfer(
        split,
        { projectId: id(3), tabId: id(0) },
        { ...options, acrossWorkspaces: false },
      ),
    ).toEqual({ ...base, targetTabId: id(0) });
  });

  it("leaves a split for a tab of its own in the same workspace, but not a lone pane", () => {
    expect(paneTransfer(split, { projectId: id(3) }, options)).toMatchObject({ newTab: true });
    expect(
      paneTransfer({ ...split, tab: { id: id(5), root: chat.id } }, { projectId: id(3) }, options),
    ).toBeNull();
  });

  it("keeps terminals, scheduled chats and its own tab where they are, and asks old daemons nothing new", () => {
    const elsewhere = { projectId: id(9), tabId: id(0) };
    expect(paneTransfer({ ...split, pane: shell }, elsewhere, options)).toBeNull();
    expect(paneTransfer(split, elsewhere, { ...options, scheduled: true })).toBeNull();
    expect(paneTransfer(split, { projectId: id(3), tabId: id(5) }, options)).toBeNull();
    expect(paneTransfer(split, elsewhere, { ...options, acrossWorkspaces: false })).toBeNull();
    expect(
      paneTransfer(split, { projectId: id(3) }, { ...options, acrossWorkspaces: false }),
    ).toBeNull();
    // A terminal can still join another tab of its own workspace.
    expect(
      paneTransfer({ ...split, pane: shell }, { projectId: id(3), tabId: id(0) }, options),
    ).toMatchObject({ targetTabId: id(0) });
  });
});
