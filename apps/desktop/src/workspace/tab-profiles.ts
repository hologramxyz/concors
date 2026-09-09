import { MessageSquare, Terminal } from "lucide-react";
import type { ComponentType } from "react";
import { CodexIcon } from "@/agents/paseo/codex-icon";
import { ClaudeIcon } from "@/agents/paseo/claude-icon";
import { OpenCodeIcon } from "@/agents/paseo/opencode-icon";
import type { PaneProfile } from "@concors/protocol";

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
