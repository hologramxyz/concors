import type { McpServer } from "@concors/protocol";
export const claudeMcp = (servers: McpServer[]) =>
  Object.fromEntries(
    servers.map((s) => [
      s.name,
      s.type === "stdio"
        ? { command: s.command, args: s.args, ...(s.env ? { env: s.env } : {}) }
        : { type: s.type, url: s.url, ...(s.headers ? { headers: s.headers } : {}) },
    ]),
  );
export const codexMcp = (servers: McpServer[]) =>
  Object.fromEntries(
    servers.map((s) => [
      s.name,
      s.type === "stdio"
        ? { command: s.command, args: s.args, ...(s.env ? { env: s.env } : {}) }
        : { url: s.url, ...(s.headers ? { http_headers: s.headers } : {}) },
    ]),
  );
export const openCodeMcp = (servers: McpServer[]) =>
  Object.fromEntries(
    servers.map((s) => [
      s.name,
      s.type === "stdio"
        ? { type: "local", command: [s.command, ...s.args], environment: s.env ?? {} }
        : { type: "remote", url: s.url, headers: s.headers ?? {} },
    ]),
  );
export const acpMcp = (servers: McpServer[]) =>
  servers.map((s) =>
    s.type === "stdio"
      ? {
          name: s.name,
          command: s.command,
          args: s.args,
          env: Object.entries(s.env ?? {}).map(([name, value]) => ({ name, value })),
        }
      : {
          name: s.name,
          type: s.type,
          url: s.url,
          headers: Object.entries(s.headers ?? {}).map(([name, value]) => ({ name, value })),
        },
  );
