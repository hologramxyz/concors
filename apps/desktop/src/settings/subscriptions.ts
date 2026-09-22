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
    // The registry preserves creation order: oldest first, newly added accounts last.
    subscriptions: providers.filter((p) => p.subscription && p.engine === engine),
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
  nickname: string | undefined,
  base: Pick<ProviderStatus, "command"> | undefined,
  random: string = crypto.randomUUID().slice(0, 8),
): ProviderConfig {
  const chosenName = nickname?.trim();
  const internalName = chosenName || "Account";
  return ProviderConfigSchema.parse({
    id: subscriptionId(engine, internalName, random),
    label: `${subscriptionEngineLabels[engine]} — ${internalName}`,
    engine,
    command: base?.command ?? [engine],
    enabled: true,
    subscription: { nickname: internalName },
    ...(chosenName ? { accountNickname: chosenName } : {}),
  });
}

/** Saveable public fields for changing an account name; the daemon preserves private settings. */
export function renamedAccountConfig(
  provider: ProviderStatus,
  accountNickname: string | undefined,
): ProviderConfig {
  return ProviderConfigSchema.parse({
    id: provider.id,
    label: provider.label,
    engine: provider.engine,
    command: provider.command,
    enabled: provider.enabled,
    models: provider.models,
    subscription: provider.subscription,
    ...(accountNickname ? { accountNickname } : {}),
  });
}

/** Public subscription fields that can be installed on another machine without moving secrets. */
export function portableSubscriptionConfig(provider: ProviderStatus): ProviderConfig {
  if (!provider.subscription) throw new Error("Choose a subscription account.");
  return renamedAccountConfig(provider, provider.accountNickname);
}
