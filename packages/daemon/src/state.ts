import type { DaemonInfo, DaemonStatus } from "@concors/protocol";
import {
  HOST_USAGE_CAPABILITY,
  PROJECT_ICON_CAPABILITY,
  PROTOCOL_VERSION,
} from "@concors/protocol";

import { DAEMON_VERSION } from "./version.ts";

/**
 * Process-wide daemon state. Deliberately tiny: it is the single source of truth for what the
 * daemon tells clients about itself (`daemon.ready`, future status broadcasts).
 */
export class DaemonState {
  #status: DaemonStatus = "starting";

  get status(): DaemonStatus {
    return this.#status;
  }

  set status(next: DaemonStatus) {
    this.#status = next;
  }

  /** Snapshot in the exact shape the protocol expects. */
  info(): DaemonInfo {
    return {
      protocolVersion: PROTOCOL_VERSION,
      daemonVersion: DAEMON_VERSION,
      status: this.#status,
      capabilities: [
        HOST_USAGE_CAPABILITY,
        "terminal-profiles",
        "color-themes",
        "project-files",
        PROJECT_ICON_CAPABILITY,
        "project-file-create",
        "folder-workspaces",
        "agent-chat",
        "agent-message-navigation",
        "agent-accounts",
        "agent-attention",
        "agent-composer",
        "agent-queue",
        "agent-providers",
        "provider-settings",
        "agent-native-controls",
        "agent-plan-implementation",
        "pane-rearrangement",
        "workspace-pane-rearrangement",
        "directional-pane-split",
        "terminal-recovery",
      ],
    };
  }
}
