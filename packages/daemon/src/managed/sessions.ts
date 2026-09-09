import { parseDaemonMessage, PROTOCOL_VERSION } from "@concors/protocol";
import { WebSocket } from "ws";
import type { HostDescriptor } from "../hosting/session-host.ts";
import { DAEMON_VERSION } from "../version.ts";

/** Read a snapshot through the existing private protocol; the host remains the sole DB owner. */
export function countHostSessions(host: HostDescriptor): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${host.port}/ws`, {
      headers: { authorization: `Bearer ${host.token}` },
      handshakeTimeout: 5000,
    });
    const sessions = new Set<string>();
    let finished = false;
    const timer = setTimeout(() => finish(new Error("Session count timed out")), 5000);
    function finish(error?: Error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.terminate();
      if (error) reject(error);
      else resolve(sessions.size);
    }
    socket.on("error", () => finish(new Error("Session count unavailable")));
    socket.on("close", () => finish(new Error("Session host disconnected")));
    socket.on("open", () =>
      socket.send(
        JSON.stringify({
          type: "client.hello",
          protocolVersion: PROTOCOL_VERSION,
          client: { kind: "cli", name: "concors-heartbeat", version: DAEMON_VERSION },
        }),
      ),
    );
    socket.on("message", (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        finish(new Error("Invalid session host response"));
        return;
      }
      const result = parseDaemonMessage(raw);
      if (!result.success) {
        finish(new Error("Invalid session host response"));
        return;
      }
      const message = result.data;
      if (message.type === "daemon.ready")
        socket.send(JSON.stringify({ type: "workspace.subscribe" }));
      if (message.type === "terminal.state") {
        if (message.session.status === "running" || message.session.status === "starting")
          sessions.add(message.session.id);
        else sessions.delete(message.session.id);
      }
      // The host sends terminal states before this snapshot, even when there are none.
      if (message.type === "workspace.snapshot") finish();
      if (message.type === "error") finish(new Error("Session count unavailable"));
    });
  });
}
