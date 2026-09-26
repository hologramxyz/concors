import type { DaemonInfo, DaemonStatus } from "@concors/protocol";
import {
  HOST_USAGE_CAPABILITY,
  RESOURCES_CAPABILITY,
  PROJECT_ICON_CAPABILITY,
  PULL_REQUESTS_CAPABILITY,
  PULL_REQUEST_ACTIONS_CAPABILITY,
  PULL_REQUEST_STATES_CAPABILITY,
  AGENT_USAGE_CAPABILITY,
  PROVIDER_SUBSCRIPTIONS_CAPABILITY,
  PROVIDER_USAGE_CAPABILITY,
  PROTOCOL_VERSION,
  DICTATION_CAPABILITY,
  PANE_RENAME_CAPABILITY,
  TERMINAL_IMAGE_PASTE_CAPABILITY,
} from "@concors/protocol";

import { DAEMON_VERSION } from "./version.ts";

/**
 * Process-wide daemon state. Deliberately tiny: it is the single source of truth for what the
 * daemon tells clients about itself (`daemon.ready`, future status broadcasts).
 */
export class DaemonState {
  #status: DaemonStatus = "starting";
  readonly #dictation: boolean;

  /** Dictation is advertised only where the daemon has somewhere durable to keep its model. */
  constructor(options: { dictation?: boolean } = {}) {
    this.#dictation = options.dictation ?? false;
  }

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
        "agent-schedules-v1",
        HOST_USAGE_CAPABILITY,
        RESOURCES_CAPABILITY,
        "terminal-profiles",
        "color-themes",
        "project-files",
        PROJECT_ICON_CAPABILITY,
        PULL_REQUESTS_CAPABILITY,
        PULL_REQUEST_ACTIONS_CAPABILITY,
        PULL_REQUEST_STATES_CAPABILITY,
        "project-file-create",
        "folder-workspaces",
        "agent-chat",
        "agent-resume-sessions",
        "agent-message-navigation",
        "agent-accounts",
        "agent-attention",
        AGENT_USAGE_CAPABILITY,
        "agent-composer",
        "agent-queue",
        "agent-providers",
        "provider-settings",
        PROVIDER_SUBSCRIPTIONS_CAPABILITY,
        PROVIDER_USAGE_CAPABILITY,
        "agent-native-controls",
        "agent-plan-implementation",
        "pane-rearrangement",
        "workspace-pane-rearrangement",
        "directional-pane-split",
        PANE_RENAME_CAPABILITY,
        "terminal-recovery",
        TERMINAL_IMAGE_PASTE_CAPABILITY,
        ...(this.#dictation ? [DICTATION_CAPABILITY] : []),
      ],
    };
  }
}
