import { homedir } from "node:os";
import { isAbsolute, join, resolve, relative, sep } from "node:path";

/** Resolve paths on the daemon machine, never against a browser's filesystem. */
export function projectDirectory(input: string, home = homedir()): string {
  const value = input.trim();
  if (!value) throw new Error("Enter a project folder name");
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) return resolve(home, value.slice(2));
  if (isAbsolute(value)) return resolve(value);
  const root = join(home, "repos");
  const directory = resolve(root, value);
  const child = relative(root, directory);
  if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child))
    throw new Error("Use a folder inside repos, or enter a full path for a different location");
  return directory;
}

export function projectDirectoryError(error: unknown, directory: string, created: boolean): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const syscall =
    error && typeof error === "object" && "syscall" in error ? error.syscall : undefined;
  let message: string;
  if (code === "EACCES" || code === "EPERM")
    message = `This machine's user cannot access or create “${directory}”. Use the default ~/repos folder or choose a location you can write to.`;
  else if (code === "EEXIST")
    message = `“${directory}” already exists. Choose Open existing folder, or use a different folder name.`;
  else if (code === "ENOENT" && syscall === "spawn git")
    message = "Git is not installed on this machine or is missing from PATH.";
  else if (code === "ENOENT")
    message = `“${directory}” or its parent folder does not exist. Check the location, or use the default ~/repos folder when creating a project.`;
  else message = (error instanceof Error ? error.message : "Project setup failed").slice(-3500);
  return (
    message.slice(0, 3500) +
    (created ? "\nThe new destination folder was preserved; inspect it before retrying." : "")
  );
}
