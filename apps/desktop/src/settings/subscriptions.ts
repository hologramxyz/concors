import type { ProviderSubscription } from "@concors/api-client";
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

/**
 * One account in the person's subscription library: public fields only, the same on every
 * computer. Sign-in state belongs to each machine and is read from it.
 */
export interface LibraryAccount {
  /** The provider configuration id it is installed under on every machine. */
  id: string;
  engine: SubscriptionEngine;
  /** The name given when it was added; the configuration's `subscription.nickname`. */
  nickname: string;
  /** A display name chosen instead of the account's email. */
  accountNickname?: string;
  /** The signed-in account last seen on any machine, normally an email. */
  accountLabel?: string;
}

export function isSubscriptionEngine(engine: string): engine is SubscriptionEngine {
  return (SUBSCRIPTION_ENGINES as readonly string[]).includes(engine);
}

/** The library as the control plane keeps it. */
export function libraryFromServer(rows: readonly ProviderSubscription[]): LibraryAccount[] {
  return rows.map((row) => ({
    id: row.id,
    engine: row.engine,
    nickname: row.nickname,
    ...(row.accountNickname ? { accountNickname: row.accountNickname } : {}),
    ...(row.accountLabel ? { accountLabel: row.accountLabel } : {}),
  }));
}

/** Subscriptions a machine holds, as library accounts. */
export function libraryFromProviders(providers: readonly ProviderStatus[]): LibraryAccount[] {
  return providers.flatMap((provider) =>
    provider.subscription && isSubscriptionEngine(provider.engine)
      ? [
          {
            id: provider.id,
            engine: provider.engine,
            nickname: provider.subscription.nickname,
            ...(provider.accountNickname ? { accountNickname: provider.accountNickname } : {}),
          },
        ]
      : [],
  );
}

/** The configuration that installs a library account on a machine, without moving secrets. */
export function libraryConfig(account: LibraryAccount): ProviderConfig {
  return ProviderConfigSchema.parse({
    id: account.id,
    label: `${subscriptionEngineLabels[account.engine]} — ${account.nickname}`,
    engine: account.engine,
    command: [account.engine],
    enabled: true,
    subscription: { nickname: account.nickname },
    ...(account.accountNickname ? { accountNickname: account.accountNickname } : {}),
  });
}

/**
 * A nickname the person chose, else the signed-in email (this machine's, else the one last seen
 * anywhere), else the nickname given when added.
 */
export function accountName(account: LibraryAccount, labels: Record<string, string>): string {
  return (
    account.accountNickname ??
    labels[account.id] ??
    account.accountLabel ??
    (account.nickname !== "Account" ? account.nickname : undefined) ??
    "Account"
  );
}
