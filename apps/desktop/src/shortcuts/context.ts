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
  // Several visible panes can provide the same command. Resolve its scope at keydown time,
  // so rapid pane navigation cannot run the previous pane's action before React re-renders.
  const handlers = new Map<CommandId, Set<{ handler: () => void; scope: () => boolean }>>();
  const listeners = new Set<() => void>();
  let available: readonly CommandId[] = [];
  const update = () => {
    available = [...handlers.keys()];
    for (const listener of listeners) listener();
  };
  const getAction = (id: CommandId) =>
    [...(handlers.get(id) ?? [])].findLast((entry) => entry.scope())?.handler;
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => available,
    run: (id: CommandId) => getAction(id)?.(),
    getAction,
    register: (id: CommandId, handler: () => void, scope = () => true) => {
      const entries = handlers.get(id) ?? new Set();
      const entry = { handler, scope };
      entries.add(entry);
      handlers.set(id, entries);
      update();
      return () => {
        entries.delete(entry);
        if (!entries.size) handlers.delete(id);
        update();
      };
    },
  };
}
export const Context = createContext<ReturnType<typeof createCommands> | null>(null);
export function useCommand(
  id: CommandId,
  enabled: boolean,
  handler: () => void,
  scope?: () => boolean,
) {
  const commands = useContext(Context);
  if (!commands) throw new Error("ShortcutProvider is missing");
  const latest = useRef({ handler, scope });
  useLayoutEffect(() => {
    latest.current = { handler, scope };
  });
  useEffect(() => {
    if (enabled)
      return commands.register(
        id,
        () => latest.current.handler(),
        () => latest.current.scope?.() ?? true,
      );
  }, [commands, id, enabled]);
}
export function useCommands() {
  const commands = useContext(Context);
  if (!commands) throw new Error("ShortcutProvider is missing");
  const available = useSyncExternalStore(commands.subscribe, commands.snapshot);
  return {
    items: BINDINGS.map((binding) => ({ ...binding, enabled: available.includes(binding.id) })),
    run: commands.run,
    getAction: commands.getAction,
  };
}
