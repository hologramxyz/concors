import { describe, expect, it } from "vitest";
import { FileDocument } from "./document";
import type { FileResult, ProjectFile } from "@concors/protocol";
const initial: ProjectFile = { path: "a.ts", content: "one", revision: "1", size: 3 };
const target = { projectId: "p", epoch: "e", path: "a.ts" };
const read = async (): Promise<FileResult["outcome"]> => ({ status: "read", file: initial });
describe("editor drafts", () => {
  it("keeps edits typed while a save is in flight", async () => {
    const doc = new FileDocument(target);
    await doc.load(read);
    doc.edit("two");
    let settle: ((result: FileResult["outcome"]) => void) | undefined;
    const saving = doc.save(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    doc.edit("three");
    settle?.({ status: "written", file: { ...initial, content: "two", revision: "2" } });
    await saving;
    expect(doc.getSnapshot().content).toBe("three");
    expect(doc.getSnapshot().base?.content).toBe("two");
    expect(doc.dirty).toBe(true);
  });
  it("preserves a dirty draft on conflict or connection loss", async () => {
    const doc = new FileDocument(target);
    await doc.load(read);
    doc.edit("my draft");
    await doc.save(async () => ({ status: "conflict", message: "Changed" }));
    expect(doc.getSnapshot()).toMatchObject({ content: "my draft", changed: true });
    await doc.save(async () => {
      throw Error("Connection lost");
    });
    expect(doc.getSnapshot()).toMatchObject({
      content: "my draft",
      error: "Connection lost",
      busy: false,
    });
  });
  it("checks disk without replacing the text being read and adopts a reviewed revision explicitly", async () => {
    const doc = new FileDocument(target);
    await doc.load(read);
    doc.edit("mine");
    await doc.check(async () => ({
      status: "read",
      file: { ...initial, content: "agent", revision: "2" },
    }));
    expect(doc.getSnapshot()).toMatchObject({ content: "mine", changed: true });
    doc.keepDraftOnLatest();
    expect(doc.getSnapshot()).toMatchObject({
      content: "mine",
      base: { revision: "2" },
      changed: false,
    });
    expect(doc.dirty).toBe(true);
  });
  it("preserves typing that arrives while a reload is in flight", async () => {
    const doc = new FileDocument(target);
    await doc.load(read);
    doc.edit("old draft");
    let settle: ((result: FileResult["outcome"]) => void) | undefined;
    const loading = doc.load(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
      true,
    );
    doc.edit("new typing");
    settle?.({ status: "read", file: { ...initial, content: "disk", revision: "2" } });
    await loading;
    expect(doc.getSnapshot()).toMatchObject({ content: "new typing", changed: true });
  });
  it("ignores an old disk check that finishes after a save", async () => {
    const doc = new FileDocument(target);
    await doc.load(read);
    let settle: ((result: FileResult["outcome"]) => void) | undefined;
    const checking = doc.check(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    doc.edit("new");
    await doc.save(async () => ({
      status: "written",
      file: { ...initial, content: "new", revision: "2" },
    }));
    settle?.({ status: "read", file: initial });
    await checking;
    expect(doc.getSnapshot()).toMatchObject({
      content: "new",
      changed: false,
      base: { revision: "2" },
    });
  });
});
