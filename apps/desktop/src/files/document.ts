import type { FileOperation, FileResult, ProjectFile } from "@concors/protocol";

type Request = (operation: FileOperation) => Promise<FileResult["outcome"]>;
export interface FileSnapshot {
  content: string;
  base: ProjectFile | null;
  busy: boolean;
  error: string | null;
  changed: boolean;
  disk: ProjectFile | null;
}
/** Drafts outlive mounted editors. Save acknowledges the submitted text, not later typing. */
export class FileDocument {
  private snapshot: FileSnapshot = {
    content: "",
    base: null,
    busy: false,
    error: null,
    changed: false,
    disk: null,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  readonly target: { projectId: string; epoch: string; path: string };
  constructor(target: FileDocument["target"]) {
    this.target = target;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(next: Partial<FileSnapshot>) {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener();
  }
  edit = (content: string) => this.update({ content });
  get dirty() {
    return this.snapshot.base !== null && this.snapshot.content !== this.snapshot.base.content;
  }

  async load(request: Request, discard = false) {
    if (this.snapshot.busy) return;
    const generation = ++this.generation;
    this.update({ busy: true, error: null });
    try {
      const result = await request({ kind: "read", ...this.target });
      if (generation !== this.generation) return;
      if (result.status !== "read")
        throw new Error("message" in result ? result.message : "Could not read file.");
      if (this.dirty && !discard)
        this.update({
          disk: result.file,
          changed: result.file.revision !== this.snapshot.base?.revision,
        });
      else
        this.update({
          base: result.file,
          content: result.file.content,
          changed: false,
          disk: null,
        });
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : "Could not read file." });
    } finally {
      if (generation === this.generation) this.update({ busy: false });
    }
  }
  async check(request: Request) {
    if (!this.snapshot.base || this.snapshot.busy) return;
    const generation = this.generation;
    try {
      const result = await request({ kind: "read", ...this.target });
      if (generation !== this.generation || this.snapshot.busy) return;
      if (result.status === "read") {
        const changed = result.file.revision !== this.snapshot.base?.revision;
        this.update({ changed, disk: changed ? result.file : null });
      } else if ("message" in result) this.update({ error: result.message });
    } catch {
      /* A disconnect is displayed by the workspace; keep the draft. */
    }
  }
  async save(request: Request) {
    const { base, content, busy } = this.snapshot;
    if (!base || busy || !this.dirty) return;
    ++this.generation;
    this.update({ busy: true, error: null });
    try {
      const result = await request({
        kind: "write",
        ...this.target,
        content,
        expectedRevision: base.revision,
      });
      if (result.status === "conflict") {
        this.update({ changed: true, error: result.message });
        return;
      }
      if (result.status !== "written")
        throw new Error("message" in result ? result.message : "Could not save file.");
      this.update({ base: result.file, changed: false, disk: null });
    } catch (error) {
      this.update({
        error: error instanceof Error ? error.message : "Could not save file. Your draft is kept.",
      });
    } finally {
      this.update({ busy: false });
    }
  }
  /** Only after reviewing the latest disk text; the next save still checks its revision. */
  keepDraftOnLatest() {
    if (this.snapshot.disk)
      this.update({ base: this.snapshot.disk, disk: null, changed: false, error: null });
  }
}
