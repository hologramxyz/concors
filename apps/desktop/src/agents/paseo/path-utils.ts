// Adapted from getpaseo/paseo, a7a708bec99e935ee4b8c6f7314a4b9a9984cfa6. Apache-2.0; see third-party/paseo-LICENSE.
// Copyright (c) 2025-present Mohamed Boudra. Modified for Concors; see docs/agent-interface.md.
export function stripCwdPrefix(filePath: string, cwd?: string): string {
  if (!cwd || !filePath) {
    return filePath;
  }

  const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = filePath.replace(/\\/g, "/");
  const prefix = `${normalizedCwd}/`;

  if (normalizedPath.startsWith(prefix)) {
    return normalizedPath.slice(prefix.length);
  }
  if (normalizedPath === normalizedCwd) {
    return ".";
  }
  return filePath;
}
