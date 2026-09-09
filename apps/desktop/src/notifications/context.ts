import { createContext, useContext, useEffect } from "react";
export const NotificationContext = createContext<{ view: (id: string) => () => void }>({
  view: () => () => undefined,
});
export function useViewedAgent(id: string, visible = true): void {
  const { view } = useContext(NotificationContext);
  useEffect(() => (visible ? view(id) : undefined), [id, view, visible]);
}
