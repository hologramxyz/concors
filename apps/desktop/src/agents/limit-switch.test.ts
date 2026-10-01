import { expect, it } from "vitest";
import type { AgentPlanUsage, ProviderStatus } from "@concors/protocol";
import { busiestWindow, limitHeadline, limitSwitchChoices, usageGlance } from "./limit-switch";

const provider = (fields: Partial<ProviderStatus> & Pick<ProviderStatus, "id">) =>
  ({
    label: fields.id,
    engine: "claude",
    enabled: true,
    command: ["claude"],
    ...fields,
  }) as ProviderStatus;
const usage = (windows: [string, number | null, string | null][]): AgentPlanUsage => ({
  provider: "claude",
  status: "available",
  planLabel: null,
  message: null,
  windows: windows.map(([label, usedPercent, resetsAt]) => ({
    id: label.toLowerCase(),
    label,
    usedPercent,
    resetsAt,
  })),
  fetchedAt: 0,
});

it("offers the engine's other accounts, and the machine's own sign-in only when replaced", () => {
  const base = provider({ id: "claude", active: false });
  const work = provider({ id: "claude-work", subscription: { nickname: "Work" }, active: true });
  const home = provider({ id: "claude-home", subscription: { nickname: "Home" }, active: false });
  const off = provider({
    id: "claude-off",
    subscription: { nickname: "Off" },
    active: false,
    enabled: false,
  });
  const codex = provider({
    id: "codex-work",
    engine: "codex",
    subscription: { nickname: "Work" },
    active: false,
  });
  expect(limitSwitchChoices([base, work, home, off, codex], "claude").map((p) => p.id)).toEqual([
    "claude-home",
    "claude",
  ]);
  // On the default account, only the subscriptions are another account.
  expect(
    limitSwitchChoices([{ ...base, active: true }, { ...work, active: false }, home], "claude").map(
      (p) => p.id,
    ),
  ).toEqual(["claude-work", "claude-home"]);
});

it("ranks an account by its fullest window and ignores windows that already rolled over", () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  expect(
    busiestWindow(
      usage([
        ["Session", 12, null],
        ["Weekly", 40, null],
      ]),
    ),
  ).toBe(40);
  expect(
    busiestWindow(
      usage([
        ["Session", 100, past],
        ["Weekly", 40, null],
      ]),
    ),
  ).toBe(40);
  expect(busiestWindow(usage([]))).toBeNull();
  expect(busiestWindow(null)).toBeNull();
});

it("summarises the two windows nearest their limit", () => {
  expect(
    usageGlance(
      usage([
        ["Session", 12, null],
        ["Weekly", 40, null],
        ["Weekly · Fable", 71.6, null],
      ]),
    ),
  ).toBe("Weekly · Fable 72% · Weekly 40%");
  expect(usageGlance(usage([["Session", null, null]]))).toBeNull();
});

it("names the engine's account and when the limit lifts", () => {
  const now = Date.parse("2026-09-30T12:00:00Z");
  expect(limitHeadline("claude", "2026-09-30T14:14:00Z", now)).toBe(
    "This Claude account reached its usage limit · resets in 2h 14m",
  );
  expect(limitHeadline("codex", null, now)).toBe("This ChatGPT account reached its usage limit");
  expect(limitHeadline("claude", "2026-09-30T11:00:00Z", now)).toBe(
    "This Claude account reached its usage limit",
  );
});
