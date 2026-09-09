import { useState, type ReactNode } from "react";

import { TabVisibility } from "./tab-visibility";

/** Keep visited tabs ready to paint without starting sessions in unvisited tabs. */
export function VisitedTab({ active, children }: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  if (!active && !visited) return null;
  return (
    <TabVisibility value={active}>
      <div hidden={!active} inert={!active} className="h-full min-h-0 min-w-0">
        {children}
      </div>
    </TabVisibility>
  );
}
