import { MessageSquare, Terminal } from "lucide-react";
import type { ComponentType } from "react";
import { CodexIcon } from "@/agents/paseo/codex-icon";
import { ClaudeIcon } from "@/agents/paseo/claude-icon";
import { OpenCodeIcon } from "@/agents/paseo/opencode-icon";
import {
  terminalProfileKind,
  type PaneProfile,
  type SavedTerminalProfile,
} from "@concors/protocol";

export const TAB_PROFILES: {
  profile: PaneProfile;
  label: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { profile: "shell", label: "Terminal", icon: Terminal },
  { profile: "chat", label: "Agent", icon: MessageSquare },
  { profile: "codex", label: "Codex", icon: CodexIcon },
  { profile: "claude", label: "Claude Code", icon: ClaudeIcon },
  { profile: "opencode", label: "OpenCode", icon: OpenCodeIcon },
];

export function profileIcon(id: string) {
  return TAB_PROFILES.find((item) => item.profile === id)?.icon ?? Terminal;
}

export function paneProfiles(profiles: readonly SavedTerminalProfile[]) {
  return [
    ...TAB_PROFILES.filter((item) => item.profile === "shell" || item.profile === "chat").map(
      (item) => ({ ...item, id: item.profile, terminalProfileId: undefined as string | undefined }),
    ),
    ...profiles.map((item) => ({
      id: item.id,
      terminalProfileId: item.id,
      profile: terminalProfileKind(item.command),
      label: item.name,
      icon: profileIcon(item.id),
    })),
  ];
}
