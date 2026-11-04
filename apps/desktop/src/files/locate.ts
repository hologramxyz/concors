import type { DaemonConnection } from "@concors/daemon-client";
import { FILE_LOCATE_CAPABILITY } from "@concors/protocol";
import type { FileLinkTarget } from "./context";

/**
 * Where a link in an agent's message really points, best guess first from the machine. Anything
 * short of an answer (an older machine, a dropped connection, no match) leaves the link as written,
 * and opening it then says what is wrong in the usual way.
 */
export async function locateFileTarget(
  connection: DaemonConnection,
  target: FileLinkTarget,
): Promise<FileLinkTarget> {
  if (
    connection.state.status !== "ready" ||
    !connection.state.daemon.capabilities?.includes(FILE_LOCATE_CAPABILITY)
  )
    return target;
  try {
    const { outcome } = await connection.requestFile(
      { kind: "locate", ...target },
      crypto.randomUUID(),
    );
    const path = outcome.status === "located" ? outcome.paths[0] : undefined;
    return path ? { ...target, path } : target;
  } catch {
    return target;
  }
}
