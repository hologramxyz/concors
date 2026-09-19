# Workspace pull requests

Each workspace shows how many GitHub pull requests are open in its repositories, at the far
right of its sidebar row. Hovering the count lists each repository's share; a repository opens
the Pull requests page filtered to it, and **View all** opens it for the whole workspace. The
**Pull requests** entry under Schedules opens every workspace's pull requests and shows the total.
Filters carry each workspace's logo. The phone sidebar shows the same counts; tapping one opens
the page for that workspace.

The page lists **Open** pull requests by default; **Merged** and **Closed** tabs show the most
recently updated ones of each, in GitHub's purple and red. Counts, in the sidebar and on the Open
tab, only ever include open pull requests, drafts included; the sidebar count's icon is green.

Open rows can be merged or closed in place: **Merge** confirms the method, and its menu offers
**Close pull request…** and **View details**. Rows only offer what the machine's GitHub account
may do, and drafts cannot be merged. Clicking a row opens its details.

Pull requests are managed without leaving Concors. Opening one shows its state, branches, size,
labels, merge readiness with its checks, description and recent conversation, with:

- **Merge…** confirms the method (the repository's allowed ones, defaulting to the account's
  usual choice). The merge carries the head that was shown, so GitHub refuses it if newer commits
  arrived. Merging is disabled when GitHub would always refuse: no write access, a draft, or
  conflicts. Out-of-date branches, branch protection and failing checks are explained and left to
  GitHub, which lets administrators merge anyway.
- **Close…** closes without merging, optionally posting a comment first.
- **Comment** posts to the conversation (⌘/Ctrl+Enter).
- **Open on GitHub** is the only link out.

GitHub's reason is shown as written when it refuses. After a change, the workspace's counts
refresh at once.

## Which repositories belong to a workspace

- A workspace inside a repository (its root or any folder in it) has that one repository.
- Any other folder has its **direct child** repositories: a child counts when it has a `.git`
  directory or worktree file. The rule is one level deep, like the workspace's
  [icon](project-icons.md): `~/repos/hologram` lists the repositories inside it, while `~/repos`,
  whose children are folders of repositories, lists none. Linked children are ignored.

A checkout's GitHub repository comes from its remotes. Only github.com remotes are recognized;
with several, Concors picks the way the GitHub CLI does: the `gh repo set-default` remote, then
`upstream`, `github`, `origin`, then the rest by name, so a fork resolves to the repository its
pull requests are opened against. Several checkouts of one repository (worktrees, copies) are
grouped and counted once; the page names the folders that hold it.

## GitHub access

The daemon reads pull requests with the GitHub token already on the machine, in this order:
`GH_TOKEN` or `GITHUB_TOKEN` in the daemon's environment, the GitHub CLI's login
(`gh auth token`), then Git's credential helper for `https://github.com`. Lookups never prompt:
terminal prompts, askpass programs and Git Credential Manager's interactive sign-in are disabled.
The token stays in the daemon; clients receive only pull request metadata and github.com links.
Concors' own GitHub integration, used for cloning, is not involved.

A machine without a token shows **Sign in to GitHub on this machine** with the command to run.
If GitHub rejects the token, the daemon forgets it and looks again on the next refresh.

## Freshness and limits

One GraphQL request covers up to thirty repositories. A pull request's detail is one more
request, with up to 50 checks and its 30 most recent comments and 20 reviews; descriptions and
comments longer than 20,000 characters are cut. While GitHub still reports mergeability as unknown,
the detail is fetched again a few times. Each repository reports its exact open
count and its 25 most recently updated open pull requests with draft, review and check state; a
repository with more links to the rest on GitHub. The daemon caches each repository for a minute,
shared by every client and workspace. Visible clients check once a minute and on window focus;
**Refresh** skips the cache unless the result is under five seconds old. A failed refresh keeps
the last listing and says so. Up to 32 child repositories per workspace and 90 repositories per
machine are listed.

A repository the account cannot see is reported on its own. Rate limits and outages fail the
refresh and are retried on the next one; failures are never cached.

## Compatibility

Listing requires the daemon's `workspace-pull-requests` capability; detail, merge, close and
comment require `pull-request-actions`; merged and closed tabs and per-repository access require
`pull-request-states`. Actions only target a repository that still belongs to
the workspace, and merges require write access (closing: triage access or authorship). Older daemons never receive
the request: the sidebar shows no counts and the page asks to update the daemon. No workspace
migration is required. The mobile companion relays `pull-request.request` through its protocol
relay like other workspace requests.
