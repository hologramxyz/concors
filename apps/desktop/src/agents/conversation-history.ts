import type { AgentConversation, AgentInfo, AgentItem } from "@concors/protocol";
import { mergeItems } from "@concors/client-core";

export const HISTORY_WINDOW = 240;
export type HistoryDirection = "latest" | "earlier" | "newer";
export interface HistoryCursor {
  before?: number;
  after?: number;
}
export interface HistorySnapshot {
  items: AgentItem[];
  hasEarlier: boolean;
  hasNewer: boolean;
  ready: boolean;
  loading: HistoryDirection | "jump" | null;
  error: { direction: HistoryDirection; message: string } | null;
  reset: number;
}

/** A contiguous, bounded window; streamed tails never splice a gap into older history. */
export class ConversationHistory {
  private snapshot: HistorySnapshot = {
    items: [],
    hasEarlier: false,
    hasNewer: false,
    ready: false,
    loading: null,
    error: null,
    reset: 0,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private revision = 0;
  private bidirectional = false;
  private following = true;
  private newest = -1;
  private read: (cursor: HistoryCursor) => Promise<AgentConversation>;
  constructor(read: (cursor: HistoryCursor) => Promise<AgentConversation>) {
    this.read = read;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(next: Partial<HistorySnapshot>) {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener();
  }
  setFollowing = (following: boolean) => {
    this.following = following;
  };
  cancel = () => {
    this.generation++;
    this.update({ loading: null });
  };
  invalidate = (agent: AgentInfo) => {
    const revision = agent.historyRevision ?? 0;
    if (revision <= this.revision) return;
    this.cancel();
    this.revision = revision;
    this.newest = -1;
    this.update({
      items: [],
      ready: false,
      hasEarlier: false,
      hasNewer: false,
      reset: this.snapshot.reset + 1,
    });
    void this.load("latest");
  };
  receive = (item: AgentItem) => {
    this.newest = Math.max(this.newest, item.position);
    const current = this.snapshot;
    const existing = current.items.some((entry) => entry.id === item.id);
    if (!existing && (current.hasNewer || item.position < (current.items[0]?.position ?? 0)))
      return;
    const items = mergeItems(current.items, [item]);
    if (this.bidirectional && items.length > HISTORY_WINDOW) {
      if (this.following) this.update({ items: items.slice(-HISTORY_WINDOW), hasEarlier: true });
      else this.update({ items: items.slice(0, HISTORY_WINDOW), hasNewer: true });
    } else this.update({ items });
  };
  /** Jump through the message index without retaining every intervening tool result. */
  reveal = async (position: number): Promise<void> => {
    this.cancel();
    if (this.snapshot.items.some((item) => item.position === position)) return;
    const generation = this.generation;
    const check = (page: AgentConversation) => {
      if (generation !== this.generation)
        throw new Error("Conversation changed. Select the message again.");
      if ((page.agent.historyRevision ?? 0) !== this.revision) {
        this.invalidate(page.agent);
        throw new Error("Conversation changed. Select the message again.");
      }
    };
    this.update({ loading: "jump", error: null });
    try {
      if (this.bidirectional) {
        const page = await this.read({ before: position + 1 });
        check(page);
        if (!page.items.some((item) => item.position === position))
          throw new Error("This message is no longer available.");
        const ids = new Set(page.items.map((item) => item.id));
        const items = mergeItems(
          page.items,
          this.snapshot.items.filter((item) => ids.has(item.id)),
        );
        this.update({
          items,
          hasEarlier: page.hasMore,
          hasNewer: !!page.hasNewer || (items.at(-1)?.position ?? -1) < this.newest,
        });
      } else {
        // Older daemons cannot reload forward pages: retain a contiguous tail.
        let items = this.snapshot.items;
        let hasEarlier = this.snapshot.hasEarlier;
        while (hasEarlier && (items[0]?.position ?? -1) > position) {
          const before = items[0]!.position;
          const page = await this.read({ before });
          check(page);
          if (!page.items.length || page.items[0]!.position >= before)
            throw new Error("This message is no longer available.");
          items = mergeItems(page.items, items);
          hasEarlier = page.hasMore;
        }
        if (!items.some((item) => item.position === position))
          throw new Error("This message is no longer available.");
        this.update({ items: mergeItems(items, this.snapshot.items), hasEarlier });
      }
    } finally {
      if (generation === this.generation) this.update({ loading: null });
    }
  };
  load = async (direction: HistoryDirection): Promise<void> => {
    const current = this.snapshot;
    if (direction !== "latest" && (current.loading || !current.ready)) return;
    if (direction === "earlier" && (!current.hasEarlier || !current.items.length)) return;
    if (
      direction === "newer" &&
      (!this.bidirectional || !current.hasNewer || !current.items.length)
    )
      return;
    const generation = ++this.generation;
    const first = current.items[0],
      last = current.items.at(-1);
    const cursor: HistoryCursor =
      direction === "earlier" && first
        ? { before: first.position }
        : direction === "newer" && last
          ? { after: last.position }
          : {};
    this.update({ loading: direction, error: null });
    try {
      const page = await this.read(cursor);
      if (generation !== this.generation) return;
      const revision = page.agent.historyRevision ?? 0;
      if (revision < this.revision) {
        this.update({ loading: null });
        return;
      }
      if (revision !== this.revision && direction !== "latest") {
        this.invalidate(page.agent);
        return;
      }
      const reset = revision !== this.revision;
      this.revision = revision;
      this.bidirectional = page.hasNewer !== undefined;
      if (reset) this.newest = -1;
      this.newest = Math.max(this.newest, page.items.at(-1)?.position ?? -1);
      const live = this.snapshot;
      let items = mergeItems(
        direction === "latest"
          ? reset
            ? []
            : live.items.filter((item) => item.position >= (page.items[0]?.position ?? Infinity))
          : live.items,
        page.items,
      );
      let hasEarlier =
        direction === "earlier" || direction === "latest" ? page.hasMore : live.hasEarlier;
      let hasNewer =
        direction === "earlier"
          ? live.hasNewer
          : !!page.hasNewer || (items.at(-1)?.position ?? -1) < this.newest;
      if (this.bidirectional && items.length > HISTORY_WINDOW) {
        if (direction === "earlier") {
          items = items.slice(0, HISTORY_WINDOW);
          hasNewer = true;
        } else {
          items = items.slice(-HISTORY_WINDOW);
          hasEarlier = true;
        }
      }
      this.update({
        items,
        hasEarlier,
        hasNewer,
        ready: true,
        loading: null,
        error: null,
        reset: live.reset + (direction === "latest" ? 1 : 0),
      });
    } catch (cause) {
      if (generation === this.generation)
        this.update({
          loading: null,
          error: {
            direction,
            message: cause instanceof Error ? cause.message : "Could not load messages",
          },
        });
    }
  };
}
