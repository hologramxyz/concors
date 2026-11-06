import { useRef, useState, type PointerEvent } from "react";
import { Plus } from "lucide-react";
import type { MobileTarget } from "@concors/client-core";
import type { WorkspaceOperation, WorkspaceProject, WorkspaceTab } from "@concors/protocol";
import { TabStrip } from "@/workspace/tab-strip";
import { TabButton } from "@/workspace/tab-button";
import { projectPanes, type PaneNode } from "./selection";
import { WorkspaceActions } from "./workspace-actions";

/** As long as a system long-press, so a slow tap still selects. */
const LONG_PRESS_MS = 500;
/** A finger that moves this far is scrolling the strip, not holding a tab. */
const LONG_PRESS_SLOP_PX = 8;

const paneKey = (tabId: string, paneId: string) => `${tabId}:${paneId}`;

/**
 * The phone's tabs, in a row under its header: desktop's strip and tab labels, with each pane of a
 * split tab as a tab of its own, in the order the old Tabs sheet listed them. A tab's "…" sheet opens
 * on a long-press, and from a hidden "More actions" button a screen reader reaches; "+" stays outside
 * the scrolling part and opens the New tab sheet. Touches that start here scroll the strip and never
 * open a side panel: the panel swipes leave `.mobile-tab-strip` alone.
 */
export function MobileTabStrip({
  project,
  tab,
  pane,
  canEdit,
  keyboard,
  execute,
  command,
  onSelect,
  onNewTab,
}: {
  project: WorkspaceProject;
  tab: WorkspaceTab | null;
  pane: PaneNode | null;
  canEdit: boolean;
  keyboard: boolean;
  execute(operation: WorkspaceOperation): Promise<void>;
  command(operation: WorkspaceOperation): void;
  onSelect(target: MobileTarget): void;
  onNewTab(): void;
}) {
  const list = useRef<HTMLDivElement>(null);
  // Stays mounted once its sheet has gone, for the rename, close or delete dialog it hands on to;
  // the count remounts it for the next long-press.
  const [menu, setMenu] = useState<{ tabId: string; paneId: string; count: number } | null>(null);
  const press = useRef<{ id: number; x: number; y: number; timer: number } | null>(null);
  // The click a held finger ends with is not a tap.
  const held = useRef(false);
  const entries = projectPanes(project);
  const active = tab && pane ? paneKey(tab.id, pane.id) : undefined;
  const current = entries.find((entry) => paneKey(entry.tab.id, entry.pane.id) === active);
  const menuEntry =
    menu && entries.find((entry) => entry.tab.id === menu.tabId && entry.pane.id === menu.paneId);
  const openMenu = (tabId: string, paneId: string) =>
    setMenu((shown) => ({ tabId, paneId, count: (shown?.count ?? 0) + 1 }));
  const release = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  const hold = (event: PointerEvent, tabId: string, paneId: string) => {
    held.current = false;
    release();
    if (event.pointerType === "mouse" || !event.isPrimary) return;
    press.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => {
        press.current = null;
        held.current = true;
        openMenu(tabId, paneId);
      }, LONG_PRESS_MS),
    };
  };
  const move = (event: PointerEvent) => {
    const current = press.current;
    if (
      current?.id === event.pointerId &&
      Math.hypot(event.clientX - current.x, event.clientY - current.y) > LONG_PRESS_SLOP_PX
    )
      release();
  };
  return (
    <>
      {/* Keeps the shown tab's shortcuts (close tab) while no sheet of its own is open. */}
      {tab && pane && (
        <WorkspaceActions
          key={paneKey(tab.id, pane.id)}
          label="Active tab actions"
          title={current?.label ?? tab.name}
          project={project}
          tab={tab}
          pane={pane}
          canEdit={canEdit}
          execute={execute}
          command={command}
          onSelect={onSelect}
          selected
          keyboard={keyboard}
          showTrigger={false}
        />
      )}
      {menu && menuEntry && (
        <WorkspaceActions
          key={menu.count}
          label={`Actions for tab ${menuEntry.label}`}
          title={menuEntry.label}
          project={project}
          tab={menuEntry.tab}
          pane={menuEntry.pane}
          selected={paneKey(menu.tabId, menu.paneId) === active}
          canEdit={canEdit}
          execute={execute}
          command={command}
          onSelect={onSelect}
          showTrigger={false}
          opened={{
            returnFocus: () =>
              list.current?.querySelector<HTMLElement>(
                `[data-pane-choice][data-value="${CSS.escape(paneKey(menu.tabId, menu.paneId))}"]`,
              ) ?? null,
          }}
        />
      )}
      <div role="group" aria-label="Tabs" className="mobile-tab-strip">
        <TabStrip
          listRef={list}
          scopeId={project.id}
          activeId={active}
          order={entries.map((entry) => paneKey(entry.tab.id, entry.pane.id)).join()}
          dragSlot={null}
          dragRegion={false}
        >
          {entries.map(({ tab: item, pane: node, label }) => {
            const key = paneKey(item.id, node.id);
            const selected = key === active;
            return (
              <div
                key={key}
                data-tab-id={key}
                data-active-tab={selected ? "" : undefined}
                // The whole 44pt box takes the tap; the selected fill is drawn smaller inside it,
                // in the phone's corner style (mobile.css).
                className="mobile-tab-strip-tab flex shrink-0 items-center"
              >
                <TabButton
                  tab={item}
                  pane={node}
                  label={label}
                  selected={selected}
                  data-pane-choice
                  data-value={key}
                  className="mobile-tab-strip-item"
                  onPointerDown={(event) => hold(event, item.id, node.id)}
                  onPointerMove={move}
                  onPointerUp={release}
                  onPointerCancel={release}
                  // Android's own long-press, and a right click; the timer above covers iPhone.
                  onContextMenu={(event) => {
                    event.preventDefault();
                    release();
                    if (held.current) return;
                    held.current = true;
                    openMenu(item.id, node.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                      event.preventDefault();
                      openMenu(item.id, node.id);
                    }
                  }}
                  onClick={() => {
                    if (held.current) {
                      held.current = false;
                      return;
                    }
                    onSelect({ projectId: project.id, tabId: item.id, paneId: node.id });
                  }}
                />
                <button
                  type="button"
                  className="sr-only"
                  aria-label={`More actions for ${label}`}
                  aria-haspopup="dialog"
                  onClick={() => openMenu(item.id, node.id)}
                />
              </div>
            );
          })}
        </TabStrip>
        <button
          type="button"
          data-new-tab-trigger
          className="mobile-tab-strip-new"
          aria-label="New tab"
          aria-haspopup="dialog"
          disabled={!canEdit || project.tabs.length >= 32}
          onClick={onNewTab}
        >
          <Plus />
        </button>
      </div>
    </>
  );
}
