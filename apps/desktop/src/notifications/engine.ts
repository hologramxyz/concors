import type { AgentInfo } from "@concors/protocol";
export interface Notice {
  id: string;
  sessionId: string;
  kind: "done" | "needs_input";
  title: string;
  body: string;
}
export interface NoticeSink {
  claim: (id: string) => Promise<boolean>;
  sound: (kind: Notice["kind"]) => void;
  show: (notice: Notice) => void;
  clear: (sessionId: string) => void;
  focused: (sessionId: string) => boolean;
  preferences: () => { sound: boolean; desktop: boolean };
}
/** Herdr-inspired policy, driven exclusively by authoritative attention IDs. */
export class AttentionEngine {
  readonly #sink: NoticeSink;
  readonly #known = new Map<string, AgentInfo>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #consumed = new Set<string>();
  #disposed = false;
  constructor(sink: NoticeSink) {
    this.#sink = sink;
  }
  observe(agent: AgentInfo, live: boolean, projectName: string): void {
    if (this.#disposed) return;
    const previous = this.#known.get(agent.id);
    this.#known.set(agent.id, agent);
    const attention = agent.attention;
    if (!attention || attention.seen || previous?.attention?.id !== attention.id) {
      clearTimeout(this.#timers.get(agent.id));
      this.#timers.delete(agent.id);
      this.#sink.clear(agent.id);
    }
    if (
      !attention ||
      attention.seen ||
      previous?.attention?.id === attention.id ||
      this.#consumed.has(attention.id)
    )
      return;
    this.#consumed.add(attention.id);
    if (this.#consumed.size > 2048) this.#consumed.delete(this.#consumed.values().next().value!);
    // Initial snapshots update badges, but never replay old sounds or desktop alerts.
    if (!live) return;
    const focused = this.#sink.focused(agent.id);
    const notice: Notice = {
      id: attention.id,
      sessionId: agent.id,
      kind: attention.kind,
      title: attention.kind === "done" ? "Agent finished" : "Agent needs input",
      body: projectName ? `${projectName} · ${agent.name}` : agent.name,
    };
    if (focused) {
      if (attention.kind === "needs_input")
        void this.#sink
          .claim(attention.id)
          .then((claimed) => {
            if (
              claimed &&
              !this.#disposed &&
              this.#known.get(agent.id)?.attention?.id === attention.id &&
              this.#sink.preferences().sound
            )
              this.#sink.sound("needs_input");
          })
          .catch(() => undefined);
      return;
    }
    this.#timers.set(
      agent.id,
      setTimeout(() => {
        this.#timers.delete(agent.id);
        void this.deliver(agent.id, notice, focused).catch(() => undefined);
      }, 300),
    );
  }
  private async deliver(id: string, notice: Notice, focusedAtArrival: boolean): Promise<void> {
    const current = this.#known.get(id);
    if (this.#disposed || current?.attention?.id !== notice.id || current.attention.seen) return;
    if (!(await this.#sink.claim(notice.id))) return;
    const latest = this.#known.get(id);
    if (this.#disposed || latest?.attention?.id !== notice.id || latest.attention.seen) return;
    const focused = focusedAtArrival || this.#sink.focused(id);
    const prefs = this.#sink.preferences();
    if (prefs.sound && (!focused || notice.kind === "needs_input")) this.#sink.sound(notice.kind);
    if (!focused && prefs.desktop) this.#sink.show(notice);
  }
  viewed(sessionId: string): void {
    this.#sink.clear(sessionId);
  }
  suspend(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    for (const id of this.#known.keys()) this.#sink.clear(id);
    this.#timers.clear();
    this.#known.clear();
  }
  dispose(): void {
    this.suspend();
    this.#disposed = true;
  }
}
