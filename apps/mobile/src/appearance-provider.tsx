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
const AppearanceReadyContext = createContext(false);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createAppearanceStore(deviceStorage));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    void store.hydrate().then(() => {
      if (mounted) setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, [store]);
  return (
    <AppearanceContext value={store}>
      <AppearanceReadyContext value={ready}>{children}</AppearanceReadyContext>
    </AppearanceContext>
  );
}

export function useAppearance() {
  const store = useContext(AppearanceContext);
  if (!store) throw new Error("Missing AppearanceProvider");
  const preferences = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const ready = useContext(AppearanceReadyContext);
  return { preferences, setPreferences: store.setPreferences, ready };
}
