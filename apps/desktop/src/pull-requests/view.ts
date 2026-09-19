import type { PullRequestState } from "@concors/protocol";

/**
 * Where the Pull requests page is: open, merged or closed pull requests of every workspace or one,
 * optionally one of its repositories, and the pull request open in place of the list. Held by the app shell so the sidebar can open
 * the page at any of these.
 */
export interface PullRequestTarget {
  readonly projectId: string;
  /** `owner/name`. */
  readonly repository: string;
  readonly number: number;
}
export interface PullRequestsView {
  readonly projectId: string | null;
  readonly repository: string | null;
  /** Open unless the person asked for merged or closed ones. */
  readonly state: PullRequestState;
  readonly pullRequest: PullRequestTarget | null;
}
export const allPullRequests: PullRequestsView = {
  projectId: null,
  repository: null,
  state: "open",
  pullRequest: null,
};
