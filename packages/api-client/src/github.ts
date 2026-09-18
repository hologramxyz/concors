import { z } from "zod";
export const GitHubStatusSchema = z.object({
  configured: z.boolean(),
  /** The Concors account has a GitHub identity linked for sign-in. */
  identityConnected: z.boolean().default(false),
  /** Repository access has been authorized separately through the Concors GitHub App. */
  connected: z.boolean(),
  login: z.string().nullable(),
  updatedAt: z.string().nullable(),
  manageUrl: z.url().nullable(),
});
export type GitHubStatus = z.infer<typeof GitHubStatusSchema>;
export const GitHubAccountsSchema = z.object({
  accounts: z.array(z.object({ id: z.number().int().positive(), login: z.string() })),
  nextPage: z.number().nullable(),
});
export const GitHubRepositoriesSchema = z.object({
  repositories: z.array(
    z.object({
      id: z.number().int().positive(),
      fullName: z.string(),
      private: z.boolean(),
      description: z.string().nullable(),
      defaultBranch: z.string(),
      url: z.url(),
    }),
  ),
  nextPage: z.number().nullable(),
});
export type GitHubRepository = z.infer<typeof GitHubRepositoriesSchema>["repositories"][number];
export const GitHubPreparedSchema = z.object({ ready: z.literal(true) });
