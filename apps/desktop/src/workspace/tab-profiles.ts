import { Bot, MessageSquare, Terminal } from "lucide-react";
import type { PaneProfile } from "@concors/protocol";

export const TAB_PROFILES: { profile: PaneProfile; label: string; icon: typeof Terminal }[] = [
  { profile: "shell", label: "Terminal", icon: Terminal },
  { profile: "chat", label: "Agent", icon: MessageSquare },
  { profile: "codex", label: "Codex", icon: Bot },
  { profile: "claude", label: "Claude Code", icon: Bot },
  { profile: "opencode", label: "OpenCode", icon: Bot },
];
