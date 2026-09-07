# Project setup

**Add project** offers three sources on the selected daemon machine:

- **Open existing folder** validates an existing absolute directory and registers its canonical path.
- **Create new folder** creates a new directory beneath an existing parent.
- **Clone repository** clones an HTTPS URL, SSH URL/scp-style address, or absolute local repository
  path into a new directory. Git must already be installed on the daemon machine.

Create and clone use exclusive directory creation. They refuse to overwrite even an empty existing
folder. Opening a folder that is already registered fails. The project appears in the sidebar only
after setup and checkout succeed, and its selected project state is synchronized to other clients.
Project removal remains metadata-only and never deletes files.

Setup is a durable daemon job. Closing the dialog or disconnecting a browser does not cancel it.
Reopen **Add project** to view recent setup status, bounded Git progress, and **Cancel setup**. Cancel
terminates the active clone's process group on Unix or process tree on Windows. A cancelled or failed
setup does not register a project. Remaining destination files are preserved for inspection; choose
a new destination for another attempt or handle the old folder explicitly on the machine.

The SQLite database migrates from user_version 2 to 3. A job receipt is saved before filesystem work.
Retrying an identical request (same request ID, setup ID and payload) returns its existing outcome
without creating another folder or clone. After a restart, unfinished jobs become interrupted and
are not silently restarted; projects registered just before a crash reconcile to completed jobs.
The current limits are four concurrent setups, 64 persisted job records and 4 KiB of progress per
job. History pruning and resumable partial clones remain future work.

Git runs directly with argument arrays, with interactive credential prompts disabled. SSH uses
batch mode and strict host-key checking. Configure the machine's credential helper/SSH agent and
known hosts before cloning private repositories. Embedded URL passwords and HTTPS usernames are
rejected; credentials are not collected by the UI. Submodules are not automatically initialized.

Validation includes real temporary directories and Git repositories, checkout contents, existing
file preservation, failed clone registration, idempotent requests, cancellation and interrupted
jobs. Chromium acceptance creates and clones through the UI, verifies another device sees the
projects, and reloads setup history. Daemon tests run on Linux, macOS and Windows in CI.
