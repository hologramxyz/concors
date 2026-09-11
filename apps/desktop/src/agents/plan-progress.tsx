// DOM adaptation of Paseo composer/task-list and plan-card; Apache-2.0.
// Copyright (c) 2025-present Mohamed Boudra. See third-party/paseo-LICENSE.
import { Check, ChevronDown, Circle, ListTodo } from "lucide-react";
import type { AgentItem } from "@concors/protocol";
import { BrailleSpinner } from "./activity";
import { AgentMarkdown, CopyButton } from "./markdown";
export function PlanProgress({ item, compact = false }: { item: AgentItem; compact?: boolean }) {
  const steps = item.presentation?.steps ?? [];
  if (!steps.length && !item.text.trim()) return null;
  const completed = steps.filter((s) => s.status === "completed").length;
  return (
    <details
      open={compact ? undefined : true}
      aria-label={compact ? "Agent tasks" : "Agent plan"}
      className={`group/plan rounded-xl border bg-muted/20 ${compact ? "mb-2" : "my-4"}`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
        <ListTodo className="size-4" />
        <span className="flex-1">
          {steps.length ? `${completed} of ${steps.length} tasks` : "Plan"}
        </span>
        {["failed", "interrupted"].includes(item.status) && (
          <span className="text-xs text-muted-foreground">{item.status}</span>
        )}
        <ChevronDown className="size-3.5 transition-transform group-open/plan:rotate-180" />
      </summary>
      <div className="chat-scroll max-h-80 space-y-3 overflow-auto border-t px-4 py-3">
        {steps.length ? (
          <ol className="space-y-2.5">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-sm leading-relaxed">
                {step.status === "completed" ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                ) : step.status === "inProgress" && item.status === "running" ? (
                  <BrailleSpinner />
                ) : (
                  <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <span className={step.status === "completed" ? "text-muted-foreground" : ""}>
                  {step.status === "inProgress" && item.status === "running"
                    ? (step.activeForm ?? step.step)
                    : step.step}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <AgentMarkdown>{item.text}</AgentMarkdown>
        )}
        <div className="flex justify-end">
          <CopyButton
            label="Copy plan"
            text={
              steps.length
                ? steps
                    .map((s) => `- [${s.status === "completed" ? "x" : " "}] ${s.step}`)
                    .join("\n")
                : item.text
            }
          />
        </div>
      </div>
    </details>
  );
}
