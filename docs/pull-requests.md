# Workspace pull requests

Each workspace shows how many GitHub pull requests are open in its repositories, at the far
right of its sidebar row. Hovering the count lists each repository's share, linking to its pull
requests on GitHub, with **View all** opening the Pull requests page for that workspace. The
**Pull requests** entry under Schedules opens every workspace's pull requests and shows the total.
The phone sidebar shows the same counts; tapping one opens the page for that workspace.

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

One GraphQL request covers up to thirty repositories. Each repository reports its exact open
count and its 25 most recently updated open pull requests with draft, review and check state; a
repository with more links to the rest on GitHub. The daemon caches each repository for a minute,
shared by every client and workspace. Visible clients check once a minute and on window focus;
**Refresh** skips the cache unless the result is under five seconds old. A failed refresh keeps
the last listing and says so. Up to 32 child repositories per workspace and 90 repositories per
machine are listed.

A repository the account cannot see is reported on its own. Rate limits and outages fail the
refresh and are retried on the next one; failures are never cached.

## Compatibility

Listing requires the daemon's `workspace-pull-requests` capability. Older daemons never receive
the request: the sidebar shows no counts and the page asks to update the daemon. No workspace
migration is required. The mobile companion relays `pull-request.request` through its protocol
relay like other workspace requests.
