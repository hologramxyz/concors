# First-run setup

The first time the desktop app opens on a device for someone with no workspaces, once the
workspace has loaded, a setup window opens. It is modelled on Paseo's setup: rather than point at
the app, it gets a new user from nothing to an agent at work, asking at each step for the one thing
that needs to happen next. Every step reuses what the rest of the app offers for the same thing, so
nothing in setup works differently from Settings or the menus.

1. **Where should your agents run?** This computer (free, nothing to set up), a Concors cloud
   machine (recommended; a size and its price are picked here, then the usual New VPS window takes
   the card and the payment), or the person's own server (the usual Connect your own server
   window). Buying or connecting needs an account: a guest gets **Sign in to continue**, and setup
   comes back where it was after signing in. A machine bought or connected here is followed: until
   Concors can reach it, the next steps show how it is getting on, and it is selected as soon as it
   can be reached.
2. **Your agents.** Claude Code, Codex and OpenCode on that machine, each Ready, or with **Install**
   or **Sign in** (the same sign-in as the model menu and Settings). One ready agent is enough;
   without one the button reads "Continue without an agent".
3. **Your first project.** Folders where Claude Code or Codex was already used on the machine
   (the daemon's `recent-folders`, read from the CLIs' own history), the newest ticked, plus Open a
   folder, Clone a repository and New empty workspace.
4. **Take your agents with you.** The App Store QR code for the iPhone app.
5. **Give your first agent a task.** A task already written, ideas to swap in, and the chat's own
   Agent and model picker. The new workspace's first chat starts its agent behind setup; **Start
   agent** sends the task there, ends setup and shows the chat.

Setup can be skipped from every step but the last, never by Escape or a click outside, since those
are meant for the windows that open on top of it. **Set up Concors** in the account menu, or in
Search as a command, opens it again.

Where setup stands is kept in `localStorage` (`concors.setup.v1`), per device and never reported:
open (with its step and the machine chosen), or done (finished or skipped). It is kept while open,
not only at the end, because two steps leave the window: signing in replaces the app with the
sign-in screen, and a cloud machine is paid for in the browser. Whether setup opens is decided once
per launch, so adding a project during setup never closes it, and someone who already has
workspaces is never stopped by it.

The code is in `apps/desktop/src/setup/`: `store.ts` (what is saved, and whether setup opens),
`model.ts` (the pure decisions, tested beside it), `setup.tsx` (the window and the machine banner)
and one file per step. `e2e/setup.spec.ts` walks it in the browser; every other spec starts with
setup already skipped (`e2e/support/setup.ts`).
