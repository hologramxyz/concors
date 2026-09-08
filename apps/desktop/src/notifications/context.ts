import { createContext, useContext, useEffect } from "react";
export const NotificationContext = createContext<{ view: (id: string) => () => void }>({
  view: () => () => undefined,
});
export function useViewedAgent(id: string): void {
  const { view } = useContext(NotificationContext);
  useEffect(() => view(id), [id, view]);
}
