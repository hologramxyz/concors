// Mode presets adapted from Paseo's codex-app-server-agent.ts (Apache-2.0; third-party/paseo-LICENSE).
import { z } from "zod";
import type { AgentInfo, AgentSettings } from "@concors/protocol";
export const defaultSettings: AgentSettings = { model: null, effort: null, mode: "default" };
export function turnControls(info: AgentInfo) {
  const settings = info.settings ?? defaultSettings;
  return {
    model: settings.model ?? info.model,
    effort: settings.effort,
    summary: "auto",
    serviceTier: settings.serviceTier ?? null,
    ...(info.supportsPlan
      ? {
          collaborationMode: {
            mode: settings.planMode ? "plan" : "default",
            settings: {
              model: settings.model ?? info.model,
              reasoning_effort: settings.effort,
              developer_instructions: null,
            },
          },
        }
      : {}),
    approvalPolicy: settings.mode === "full-access" ? "never" : "on-request",
    approvalsReviewer: settings.mode === "auto-review" ? "auto_review" : "user",
    sandboxPolicy: settings.planMode
      ? { type: "readOnly" }
      : settings.mode === "full-access"
        ? { type: "dangerFullAccess" }
        : {
            type: "workspaceWrite",
            writableRoots: [info.directory],
            networkAccess: false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
          },
  };
}
const Catalog = z.object({
  data: z.array(
    z.object({
      model: z.string(),
      displayName: z.string(),
      hidden: z.boolean().optional(),
      serviceTiers: z
        .array(z.object({ id: z.string(), name: z.string(), description: z.string() }))
        .default([]),
      supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string() })).default([]),
      defaultReasoningEffort: z.string().nullable().optional(),
    }),
  ),
});
export function parseModels(raw: unknown): NonNullable<AgentInfo["models"]> {
  return Catalog.parse(raw)
    .data.filter((m) => !m.hidden)
    .slice(0, 100)
    .map((m) => ({
      id: m.model,
      label: m.displayName,
      efforts: m.supportedReasoningEfforts.map((e) => e.reasoningEffort),
      defaultEffort: m.defaultReasoningEffort ?? null,
      serviceTiers: m.serviceTiers
        .slice(0, 20)
        .map((tier) => ({ id: tier.id, label: tier.name, description: tier.description })),
    }));
}
