import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { open, opendir } from "node:fs/promises";
import { promisify } from "node:util";
import { MAX_PROJECT_ICON_BYTES, type ProjectIcon } from "@concors/protocol";
import { resolveProjectPath } from "./paths.ts";

const exec = promisify(execFile);
const folders = ["", "public", "static", "assets", "app", "src/app", "src", "src/assets"];
const names = ["favicon.svg", "favicon.png", "favicon.ico", "favicon.webp"];

/** Fixed local candidates only; never follow a repository's remote URL or HTML links. */
export async function readProjectIcon(root: string): Promise<ProjectIcon> {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_COMMON_DIR;
  delete env.GIT_INDEX_FILE;
  try {
    const { stdout } = await exec("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
      timeout: 1500,
      maxBuffer: 4096,
      windowsHide: true,
      env,
    });
    if (stdout.trim() !== "true") return { isGit: false, source: null };
  } catch {
    return { isGit: false, source: null };
  }
  const roots = [""];
  // Also recognize the standard web-app folders of a monorepo, with bounded scanning.
  for (const container of ["apps", "packages"]) {
    try {
      const children: string[] = [];
      let scanned = 0;
      for await (const child of await opendir(await resolveProjectPath(root, container))) {
        if (++scanned > 128) break;
        if (child.isDirectory() && !child.name.startsWith(".")) children.push(child.name);
      }
      roots.push(
        ...children
          .sort()
          .slice(0, 32)
          .map((name) => `${container}/${name}`),
      );
    } catch {
      /* An absent or linked candidate is not an icon source. */
    }
  }
  let inspected = 0;
  for (const base of roots)
    for (const folder of folders) {
      if (++inspected > 128) return { isGit: true, source: null };
      try {
        await resolveProjectPath(root, [base, folder].filter(Boolean).join("/"));
      } catch {
        continue;
      }
      const candidates = folder.endsWith("app") ? [...names, "icon.svg", "icon.png"] : names;
      for (const name of candidates) {
        const path = [base, folder, name].filter(Boolean).join("/");
        const source = await readIcon(root, path).catch(() => null);
        if (source) return { isGit: true, source };
      }
    }
  return { isGit: true, source: null };
}

async function readIcon(root: string, path: string): Promise<string | null> {
  const file = await resolveProjectPath(root, path);
  const handle = await open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || !stat.size || stat.size > MAX_PROJECT_ICON_BYTES) return null;
    const bytes = Buffer.alloc(MAX_PROJECT_ICON_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await handle.read(bytes, size, bytes.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_PROJECT_ICON_BYTES) return null;
    const content = bytes.subarray(0, size);
    let mime: string;
    if (
      path.endsWith(".png") &&
      content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      mime = "png";
    else if (path.endsWith(".ico") && content.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0])))
      mime = "x-icon";
    else if (
      path.endsWith(".webp") &&
      content.toString("ascii", 0, 4) === "RIFF" &&
      content.toString("ascii", 8, 12) === "WEBP"
    )
      mime = "webp";
    else if (path.endsWith(".svg") && /<svg[\s>]/i.test(content.toString("utf8"))) mime = "svg+xml";
    else return null;
    return `data:image/${mime};base64,${content.toString("base64")}`;
  } finally {
    await handle.close();
  }
}
