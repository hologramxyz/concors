import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

export const canonicalDirectory = async (directory: string) =>
  realpath(directory).catch(() => resolve(directory));
