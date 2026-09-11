// Mode presets adapted from Paseo's codex-app-server-agent.ts (Apache-2.0; third-party/paseo-LICENSE).
import { z } from "zod";
import {
  AgentModelIdSchema,
  MAX_AGENT_MODELS,
  type AgentInfo,
  type AgentSettings,
} from "@concors/protocol";
export const defaultSettings: AgentSettings = { model: null, effort: null, mode: "default" };
export function turnControls(info: AgentInfo) {
  const settings = info.settings ?? defaultSettings;
  return {
    model: settings.model ?? info.model,
    effort: settings.effort,
    summary: "auto",
    serviceTier: settings.serviceTier ?? null,
    ...((info.engine ?? info.provider) === "codex"
      ? {}
      : { nativeMode: settings.nativeMode ?? null, features: settings.features ?? {} }),
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
      model: AgentModelIdSchema,
      displayName: z.string(),
      resolvedModel: AgentModelIdSchema.optional(),
      isDefault: z.boolean().optional(),
      description: z.string().optional(),
      hidden: z.boolean().optional(),
      serviceTiers: z
        .array(z.object({ id: z.string(), name: z.string(), description: z.string() }))
        .default([]),
      supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string() })).default([]),
      defaultReasoningEffort: z.string().nullable().optional(),
      supportsImages: z.boolean().optional(),
      contextWindow: z.number().positive().optional(),
    }),
  ),
});
export function parseModels(raw: unknown, filter?: string[]): NonNullable<AgentInfo["models"]> {
  const models = Catalog.parse(raw).data.filter(
    (m) => !m.hidden && (!filter?.length || filter.includes(m.model)),
  );
  if (models.length > MAX_AGENT_MODELS)
    throw new Error(
      `This provider reports more than ${MAX_AGENT_MODELS} models. Filter its catalog in provider settings.`,
    );
  return models.map((m) => ({
    id: m.model,
    label: m.displayName,
    ...(m.resolvedModel ? { resolvedModel: m.resolvedModel } : {}),
    ...(m.isDefault === undefined ? {} : { isDefault: m.isDefault }),
    ...(m.description ? { description: m.description } : {}),
    efforts: m.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    defaultEffort: m.defaultReasoningEffort ?? null,
    ...(m.supportsImages === undefined ? {} : { supportsImages: m.supportsImages }),
    ...(m.contextWindow === undefined ? {} : { contextWindow: m.contextWindow }),
    serviceTiers: m.serviceTiers
      .slice(0, 20)
      .map((tier) => ({ id: tier.id, label: tier.name, description: tier.description })),
  }));
}
