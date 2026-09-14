import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createAppearanceStore } from "./appearance";
import { deviceStorage } from "./platform/storage";

const AppearanceContext = createContext<ReturnType<typeof createAppearanceStore> | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createAppearanceStore(deviceStorage));
  useEffect(() => {
    void store.hydrate();
  }, [store]);
  return <AppearanceContext value={store}>{children}</AppearanceContext>;
}

export function useAppearance() {
  const store = useContext(AppearanceContext);
  if (!store) throw new Error("Missing AppearanceProvider");
  const preferences = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { preferences, setPreferences: store.setPreferences };
}
