import { expect, it, vi } from "vitest";
import {
  closePullRequest,
  commentOnPullRequest,
  mergePullRequest,
} from "./pull-request-actions.ts";
import { GitHubAuthError } from "./graphql.ts";

const answer = (body: unknown, status = 200) =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    Response.json(body, { status }),
  );
const sent = (request: ReturnType<typeof answer>) =>
  JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as {
    query: string;
    variables: Record<string, unknown>;
  };

it("merges with the chosen method and the head the person reviewed", async () => {
  const request = answer({ data: { mergePullRequest: { pullRequest: { state: "MERGED" } } } });
  await mergePullRequest("token", "PR_node", "squash", "a".repeat(40), request);
  const { query, variables } = sent(request);
  expect(query).toContain("mergePullRequest");
  expect(variables).toEqual({ id: "PR_node", method: "SQUASH", head: "a".repeat(40) });
  expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "bearer token" });
});

it("closes and comments by node ID", async () => {
  const close = answer({ data: { closePullRequest: { pullRequest: { state: "CLOSED" } } } });
  await closePullRequest("token", "PR_node", close);
  expect(sent(close).variables).toEqual({ id: "PR_node" });
  const comment = answer({ data: { addComment: { subject: { id: "PR_node" } } } });
  await commentOnPullRequest("token", "PR_node", "Thanks!", comment);
  expect(sent(comment).variables).toEqual({ id: "PR_node", body: "Thanks!" });
});

it("surfaces GitHub's reason when it refuses", async () => {
  await expect(
    mergePullRequest(
      "token",
      "PR_node",
      "merge",
      "a".repeat(40),
      answer({
        data: { mergePullRequest: null },
        errors: [{ message: "Head branch was modified. Review and try the merge again." }],
      }),
    ),
  ).rejects.toThrow("Head branch was modified");
  await expect(
    closePullRequest("token", "PR_node", answer({ message: "Bad credentials" }, 401)),
  ).rejects.toBeInstanceOf(GitHubAuthError);
  await expect(
    closePullRequest(
      "token",
      "PR_node",
      answer({ message: "Resource protected by organization SAML enforcement." }, 403),
    ),
  ).rejects.toThrow("SAML");
});
