import {
  ProviderConfigSchema,
  SUBSCRIPTION_ENGINES,
  type ProviderConfig,
  type ProviderStatus,
} from "@concors/protocol";

export type SubscriptionEngine = (typeof SUBSCRIPTION_ENGINES)[number];
export const subscriptionEngineLabels: Record<SubscriptionEngine, string> = {
  claude: "Claude",
  codex: "ChatGPT",
};
export interface SubscriptionGroup {
  engine: SubscriptionEngine;
  label: string;
  base: ProviderStatus | undefined;
  subscriptions: ProviderStatus[];
}
/** One group per supported engine: the built-in sign-in plus every extra subscription. */
export function subscriptionGroups(providers: ProviderStatus[]): SubscriptionGroup[] {
  return SUBSCRIPTION_ENGINES.map((engine) => ({
    engine,
    label: subscriptionEngineLabels[engine],
    base: providers.find((p) => p.id === engine && !p.subscription),
    subscriptions: providers
      .filter((p) => p.subscription && p.engine === engine)
      .sort((a, b) => a.label.localeCompare(b.label)),
  }));
}
export function subscriptionId(
  engine: SubscriptionEngine,
  nickname: string,
  random: string,
): string {
  const slug = nickname
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return [engine, ...(slug ? [slug] : []), random].join("-");
}
/** The provider configuration behind a new subscription; the daemon adds its credential home. */
export function subscriptionConfig(
  engine: SubscriptionEngine,
  nickname: string,
  base: Pick<ProviderStatus, "command"> | undefined,
  random: string = crypto.randomUUID().slice(0, 8),
): ProviderConfig {
  return ProviderConfigSchema.parse({
    id: subscriptionId(engine, nickname, random),
    label: `${subscriptionEngineLabels[engine]} — ${nickname.trim()}`,
    engine,
    command: base?.command ?? [engine],
    enabled: true,
    subscription: { nickname: nickname.trim() },
  });
}
