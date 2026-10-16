import {
  LEGACY_MESSAGE_ATTACHMENTS,
  MAX_MESSAGE_IMAGES,
  type AgentInfo,
  type AgentItem,
  type DaemonMessage,
} from "@concors/protocol";

/**
 * Clients from before attachment uploads accept at most three files on a queued message and
 * eight on a chat item, and drop the whole message (or a whole page of history) that has more.
 * They are sent the first ones instead, so a chat with many attachments still shows for them.
 */
export function forLegacyClients(message: DaemonMessage): DaemonMessage {
  switch (message.type) {
    case "agent.state":
      return { ...message, agent: queue(message.agent) };
    case "agent.list":
      return { ...message, agents: message.agents.map(queue) };
    case "agent.item":
      return { ...message, item: item(message.item) };
    case "agent.result": {
      if (message.outcome.status !== "ok") return message;
      const { conversation, childItems } = message.outcome;
      return {
        ...message,
        outcome: {
          ...message.outcome,
          conversation: {
            ...conversation,
            agent: queue(conversation.agent),
            items: conversation.items.map(item),
          },
          ...(childItems ? { childItems: childItems.map(item) } : {}),
        },
      };
    }
    default:
      return message;
  }
}

function queue(agent: AgentInfo): AgentInfo {
  if (!agent.queue?.some((entry) => entry.attachments.length > LEGACY_MESSAGE_ATTACHMENTS))
    return agent;
  return {
    ...agent,
    queue: agent.queue.map((entry) => ({
      ...entry,
      attachments: entry.attachments.slice(0, LEGACY_MESSAGE_ATTACHMENTS),
    })),
  };
}

function item(value: AgentItem): AgentItem {
  if (!value.attachments || value.attachments.length <= MAX_MESSAGE_IMAGES) return value;
  return { ...value, attachments: value.attachments.slice(0, MAX_MESSAGE_IMAGES) };
}
