import type { DaemonConnection } from "@concors/daemon-client";
import type { AgentAccountAction } from "@concors/protocol";

/** One provider's account requests run one at a time; the daemon's flows are per provider. */
const accountQueues = new Map<string, Promise<unknown>>();

/** Fires when an account is connected, so a prompt still asking for it can check again. */
export const accountChanges = new EventTarget();

export function requestAccount(
  connection: DaemonConnection,
  id: string,
  action: AgentAccountAction,
) {
  const key = `${connection.endpoint.url}:${id}`;
  const task = async () => {
    const result = await connection.requestProvider(
      { kind: "account", id, action },
      crypto.randomUUID(),
    );
    if (result.outcome.status === "error") throw new Error(result.outcome.message);
    const account = result.outcome.account;
    if (!account) throw new Error("This machine needs a daemon update to connect accounts here.");
    return account;
  };
  const next = (accountQueues.get(key) ?? Promise.resolve()).then(task, task);
  accountQueues.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}
