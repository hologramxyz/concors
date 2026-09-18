import type { MergeMethod } from "@concors/protocol";
import { gitHubGraphQL, graphQLError } from "./graphql.ts";

/**
 * Merge, close and comment, each one GraphQL mutation by node ID. They either succeed or throw
 * GitHub's own reason (conflicts, required reviews, a newer head), which is shown as written.
 */
const MERGE = `mutation($id: ID!, $method: PullRequestMergeMethod!, $head: GitObjectID!) {
  mergePullRequest(input: { pullRequestId: $id, mergeMethod: $method, expectedHeadOid: $head }) {
    pullRequest { state }
  }
}`;
const CLOSE = `mutation($id: ID!) {
  closePullRequest(input: { pullRequestId: $id }) { pullRequest { state } }
}`;
const COMMENT = `mutation($id: ID!, $body: String!) {
  addComment(input: { subjectId: $id, body: $body }) { subject { id } }
}`;

async function mutate(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  request: typeof fetch,
): Promise<void> {
  const error = graphQLError(await gitHubGraphQL(token, query, variables, request));
  if (error) throw new Error(error);
}

export function mergePullRequest(
  token: string,
  id: string,
  method: MergeMethod,
  expectedHeadSha: string,
  request: typeof fetch = fetch,
): Promise<void> {
  return mutate(token, MERGE, { id, method: method.toUpperCase(), head: expectedHeadSha }, request);
}

export function closePullRequest(
  token: string,
  id: string,
  request: typeof fetch = fetch,
): Promise<void> {
  return mutate(token, CLOSE, { id }, request);
}

export function commentOnPullRequest(
  token: string,
  id: string,
  body: string,
  request: typeof fetch = fetch,
): Promise<void> {
  return mutate(token, COMMENT, { id, body }, request);
}
