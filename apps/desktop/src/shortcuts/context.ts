import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { BINDINGS, type CommandId } from "./bindings";
export function createCommands() {
  const handlers = new Map<CommandId, () => void>();
  const listeners = new Set<() => void>();
  let available: readonly CommandId[] = [];
  const update = () => {
    available = [...handlers.keys()];
    for (const listener of listeners) listener();
  };
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => available,
    run: (id: CommandId) => handlers.get(id)?.(),
    register: (id: CommandId, handler: () => void) => {
      handlers.set(id, handler);
      update();
      return () => {
        if (handlers.get(id) === handler) {
          handlers.delete(id);
          update();
        }
      };
    },
  };
}
export const Context = createContext<ReturnType<typeof createCommands> | null>(null);
export function useCommand(id: CommandId, enabled: boolean, handler: () => void) {
  const commands = useContext(Context);
  if (!commands) throw new Error("ShortcutProvider is missing");
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (enabled) return commands.register(id, () => latest.current());
  }, [commands, id, enabled]);
}
export function useCommands() {
  const commands = useContext(Context);
  if (!commands) throw new Error("ShortcutProvider is missing");
  const available = useSyncExternalStore(commands.subscribe, commands.snapshot);
  return {
    items: BINDINGS.map((binding) => ({ ...binding, enabled: available.includes(binding.id) })),
    run: commands.run,
  };
}
