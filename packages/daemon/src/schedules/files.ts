import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { constants, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AgentUpload } from "@concors/protocol";
import { PARTIAL_UPLOAD, UPLOADS_DIRECTORY } from "../agents/attachments.ts";

/**
 * Files attached to a schedule, kept under `<attachments>/schedules/<scheduleId>/<uploadId>/` for
 * as long as the schedule lists them. A client uploads a file as it would for a chat message; the
 * schedule then claims it out of the upload staging area, where unsent uploads are swept away.
 *
 * A run does not send these files themselves: it stages a fresh copy of each and sends those,
 * which the chat claims as it would any message's files. Copies, not links, so an agent that
 * edits the file it was sent cannot change what later runs get; where the filesystem can clone
 * (APFS, Btrfs) a copy takes no space until one of them changes. The chat then shows them on the run's message and removes them with
 * itself, and editing or deleting the schedule never touches a file a past run already sent.
 *
 * Claiming is synchronous because schedule changes are: it runs inside the change's database
 * transaction, so a file that is missing fails the change before anything is saved.
 */
export const SCHEDULE_FILES_DIRECTORY = "schedules";

const scheduleDirectory = (root: string, scheduleId: string) =>
  join(root, SCHEDULE_FILES_DIRECTORY, scheduleId);

/** The one finished file in an upload's directory, or nothing. */
function storedName(directory: string) {
  const names = (() => {
    try {
      return readdirSync(directory);
    } catch {
      return [];
    }
  })();
  return names.length === 1 && names[0] !== PARTIAL_UPLOAD ? names[0] : undefined;
}

/**
 * Moves newly attached files from upload staging into the schedule's directory. Files it already
 * keeps stay where they are. Every new file is checked before any is moved, so a change that
 * names a file no longer on the machine moves nothing.
 */
export function claimScheduleFiles(root: string, scheduleId: string, files: AgentUpload[]) {
  const directory = scheduleDirectory(root, scheduleId);
  const incoming = files.filter((file) => !storedName(join(directory, file.uploadId)));
  for (const file of incoming)
    if (!storedName(join(root, UPLOADS_DIRECTORY, file.uploadId)))
      throw new Error(`${file.name} is no longer on this machine. Attach it again.`);
  if (incoming.length) mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const file of incoming)
    renameSync(join(root, UPLOADS_DIRECTORY, file.uploadId), join(directory, file.uploadId));
}

/**
 * Removes what no schedule refers to any more: files taken off a schedule, a deleted schedule's
 * directory, and anything a change that failed after claiming left behind.
 */
export function pruneScheduleFiles(
  root: string,
  schedules: { id: string; files?: AgentUpload[] | undefined }[],
) {
  const base = join(root, SCHEDULE_FILES_DIRECTORY);
  const kept = new Map(
    schedules.map((s) => [s.id, new Set((s.files ?? []).map((f) => f.uploadId))]),
  );
  const list = (directory: string) => {
    try {
      return readdirSync(directory);
    } catch {
      return [];
    }
  };
  for (const scheduleId of list(base)) {
    const files = kept.get(scheduleId);
    if (!files?.size) {
      rmSync(join(base, scheduleId), { recursive: true, force: true });
      continue;
    }
    for (const uploadId of list(join(base, scheduleId)))
      if (!files.has(uploadId))
        rmSync(join(base, scheduleId, uploadId), { recursive: true, force: true });
  }
}

/**
 * Stages a fresh upload of each of a schedule's files, for one run's message to send. If one is
 * missing, those staged so far are removed and the run fails saying which file it was.
 */
export async function stageScheduleFiles(
  root: string,
  scheduleId: string,
  files: AgentUpload[],
): Promise<AgentUpload[]> {
  const staged: AgentUpload[] = [];
  try {
    for (const file of files) {
      const source = join(scheduleDirectory(root, scheduleId), file.uploadId);
      const name = storedName(source);
      if (!name) throw new Error(`${file.name} is no longer attached to this schedule.`);
      const uploadId = randomUUID();
      const target = join(root, UPLOADS_DIRECTORY, uploadId);
      await mkdir(target, { recursive: true, mode: 0o700 });
      staged.push({ ...file, uploadId });
      await copyFile(join(source, name), join(target, name), constants.COPYFILE_FICLONE);
    }
    return staged;
  } catch (error) {
    await discardStaged(root, staged);
    throw error;
  }
}

/** Removes staged uploads a run did not get to send. */
export async function discardStaged(root: string, uploads: AgentUpload[]) {
  await Promise.all(
    uploads.map((upload) =>
      rm(join(root, UPLOADS_DIRECTORY, upload.uploadId), { recursive: true, force: true }),
    ),
  );
}
