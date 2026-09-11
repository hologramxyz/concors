import type { AgentAccount, AgentAccountMethod } from "@concors/protocol";

export type AccountChallenge = Omit<NonNullable<AgentAccount["challenge"]>, "flowId" | "expiresAt">;
export interface AccountBackend {
  read(): Promise<{ connected: boolean; label?: string; methods: AgentAccountMethod[] }>;
  start(methodId: string, done: (error?: Error) => void): Promise<AccountChallenge>;
  complete(value: string): Promise<void>;
  close(): Promise<void>;
}
export function browserUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || value.length > 8192)
    throw new Error("Provider returned an invalid sign-in link");
  return url.href;
}
