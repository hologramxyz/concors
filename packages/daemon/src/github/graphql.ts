/**
 * One request to GitHub's GraphQL API with the machine's token.
 *
 * Transport, credential and rate-limit failures throw, since every query in the request would
 * fail the same way. GraphQL errors (a missing repository, a merge GitHub refuses) are returned
 * with the body for the caller to attribute.
 */
export class GitHubAuthError extends Error {}

const ENDPOINT = "https://api.github.com/graphql";

export const clip = (text: string, length: number) =>
  text.length > length ? text.slice(0, length) : text;

export async function gitHubGraphQL(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  request: typeof fetch = fetch,
): Promise<unknown> {
  const response = await request(ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "Concors",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 401)
    throw new GitHubAuthError("GitHub rejected this machine's credentials.");
  if (response.status === 403 || response.status === 429) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    const message = typeof body?.message === "string" ? body.message : "";
    throw new Error(
      !message || /rate limit/i.test(message)
        ? "GitHub's rate limit was reached. Try again shortly."
        : clip(`GitHub refused the request: ${message}`, 500),
    );
  }
  if (!response.ok) throw new Error(`GitHub is unavailable (HTTP ${response.status}).`);
  return response.json();
}

/** The first GraphQL error message, for mutations that either fully succeed or fail. */
export function graphQLError(body: unknown): string | null {
  const errors = (body as { errors?: { message?: unknown }[] } | null)?.errors;
  if (!Array.isArray(errors) || !errors.length) return null;
  const message = errors[0]?.message;
  return clip(
    typeof message === "string" && message ? message : "GitHub refused the request.",
    500,
  );
}
