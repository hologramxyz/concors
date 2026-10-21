import { readFileSync, writeFileSync } from "node:fs";

/**
 * Whether the machine ran out of memory while the agents ran, so that, once the session host is
 * back, an interrupted chat can say so rather than only that the daemon restarted. The kernel
 * counts the processes it killed for memory since boot (`oom_kill` in /proc/vmstat), readable
 * without privileges. The host records that count as it runs; a higher count in the same boot at
 * its next start means memory ran out since. It cannot tell which process was killed, and it does
 * not prevent anything; Linux only, and silent wherever the count cannot be read.
 */
export interface MemoryKills {
  readonly boot: string;
  readonly kills: number;
}

/** Reads /proc/vmstat's `oom_kill` and the boot it belongs to. */
export function parseMemoryKills(vmstat: string, boot: string): MemoryKills | null {
  const match = /^oom_kill (\d+)$/m.exec(vmstat);
  return match && boot.trim() ? { boot: boot.trim(), kills: Number(match[1]) } : null;
}

/** True when memory ran out between the recorded count and now, within one boot. */
export function ranOutOfMemory(recorded: MemoryKills | null, now: MemoryKills | null): boolean {
  return !!recorded && !!now && recorded.boot === now.boot && now.kills > recorded.kills;
}

export class MemoryKillWatch {
  private file: string;
  private read: () => MemoryKills | null;
  constructor(
    file: string,
    read = () =>
      parseMemoryKills(
        readFileSync("/proc/vmstat", "utf8"),
        readFileSync("/proc/sys/kernel/random/boot_id", "utf8"),
      ),
  ) {
    this.file = file;
    this.read = () => {
      try {
        return read();
      } catch {
        return null;
      }
    };
  }
  /** Whether memory ran out since the count was last recorded. */
  ranOutSinceRecorded(): boolean {
    let recorded: MemoryKills | null = null;
    try {
      const value = JSON.parse(readFileSync(this.file, "utf8")) as Partial<MemoryKills>;
      if (typeof value.boot === "string" && typeof value.kills === "number")
        recorded = { boot: value.boot, kills: value.kills };
    } catch {
      // Never recorded, as on a first start or off Linux.
    }
    return ranOutOfMemory(recorded, this.read());
  }
  record(): void {
    const now = this.read();
    if (!now) return;
    try {
      writeFileSync(this.file, JSON.stringify(now));
    } catch {
      // Best effort: a missed record only means a later restart reads as a plain one.
    }
  }
}
