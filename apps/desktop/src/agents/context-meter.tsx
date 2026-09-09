// DOM adaptation of Paseo components/context-window-meter.tsx; Apache-2.0.
// Copyright (c) 2025-present Mohamed Boudra. See third-party/paseo-LICENSE.
import { Popover } from "radix-ui";
import type { AgentInfo } from "@concors/protocol";
import { formatTokenCount } from "./paseo/context-window-meter.utils";
export function ContextMeter({ context }: { context: AgentInfo["context"] }) {
  const percent = context?.limit
    ? Math.max(0, Math.min(100, (context.used / context.limit) * 100))
    : null;
  return (
    <Popover.Root>
      <Popover.Trigger
        type="button"
        aria-label="Context window"
        title={percent === null ? "Context usage pending" : `${Math.round(percent)}% context used`}
        className="agent-control"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className={`size-4 -rotate-90 ${percent !== null && percent > 90 ? "text-destructive" : percent !== null && percent >= 70 ? "text-amber-500" : ""}`}
        >
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            opacity="0.2"
          />
          {percent !== null && (
            <circle
              cx="8"
              cy="8"
              r="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray={Math.PI * 12}
              strokeDashoffset={Math.PI * 12 * (1 - percent / 100)}
            />
          )}
        </svg>
        <span className="sr-only">
          {percent === null ? "Usage pending" : `${Math.round(percent)}% context`}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={8}
          className="z-50 rounded-xl border bg-popover p-4 text-sm shadow-lg"
        >
          <p className="font-medium">Context window</p>
          <p className="mt-2 text-muted-foreground">
            {context?.limit
              ? `${formatTokenCount(context.used)} / ${formatTokenCount(context.limit)} tokens · ${Math.round(percent ?? 0)}% used`
              : "Usage will appear after the agent reports it."}
          </p>
          {context && (
            <p className="mt-1 text-xs text-muted-foreground">
              {formatTokenCount(context.total)} cumulative tokens
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
