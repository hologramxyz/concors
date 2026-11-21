import { createContext, useContext, useEffect } from "react";
export const NotificationContext = createContext<{
  view: (id: string) => () => void;
  list: (ids: readonly string[]) => () => void;
}>({
  view: () => () => undefined,
  list: () => () => undefined,
});
export function useViewedAgent(id: string, visible = true): void {
  const { view } = useContext(NotificationContext);
  useEffect(() => (visible ? view(id) : undefined), [id, view, visible]);
}
/**
 * Sessions whose state is on screen without their chat open, as Overview shows them. A card or
 * banner would only repeat what is in view, so none is shown; the session stays unread.
 */
export function useListedAgents(ids: readonly string[], visible = true): void {
  const { list } = useContext(NotificationContext);
  const key = ids.join(" ");
  useEffect(() => (visible && key ? list(key.split(" ")) : undefined), [key, list, visible]);
}
