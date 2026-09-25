import type { WorkspaceTab } from "./workspace.ts";

/** A new workspace tab names its container, not whichever pane it starts with.
 * Existing names are never rewritten. Count custom/legacy tabs and skip every
 * numbered name still in use, independently of tab order and pane profiles.
 */
/** Whether a tab still has the numbered name it was created with. */
export function isDefaultTabName(name: string): boolean {
  return /^Tab [1-9]\d*$/i.test(name);
}

export function nextWorkspaceTabName(tabs: readonly Pick<WorkspaceTab, "name">[]): string {
  let next = tabs.length + 1;
  for (const tab of tabs) {
    const match = /^Tab ([1-9]\d*)$/i.exec(tab.name);
    if (!match) continue;
    const number = Number(match[1]);
    if (Number.isSafeInteger(number) && number < Number.MAX_SAFE_INTEGER)
      next = Math.max(next, number + 1);
  }
  const names = new Set(tabs.map((tab) => tab.name.toLowerCase()));
  if (next === Number.MAX_SAFE_INTEGER && names.has(`tab ${next}`)) next = tabs.length + 1;
  while (names.has(`tab ${next}`)) next++;
  return `Tab ${next}`;
}
