/**
 * @concors/daemon-client
 *
 * Connects any Concors client to any Concors daemon using nothing but `@concors/protocol` and the
 * standard WebSocket API. Works unchanged against `ws://127.0.0.1:<port>` (a bundled local daemon)
 * and `wss://remote-daemon.example` (a daemon on the user's VPS).
 */

export {
  DaemonConnection,
  DaemonConnectionError,
  type ConnectionState,
  type ConnectionStateListener,
  type DaemonConnectionOptions,
  type WebSocketFactory,
  type WebSocketLike,
} from "./connection.ts";
export {
  InvalidDaemonUrlError,
  describeDaemonEndpoint,
  localDaemonEndpoint,
  type DaemonEndpoint,
} from "./endpoint.ts";
