import { expect, it } from "vitest";
import { mcpServerInput, secretKeys } from "./mcp-servers";

it("sends a saved server back with its secrets kept by name, never by value", () => {
  const stdio = {
    name: "github",
    type: "stdio" as const,
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envKeys: ["GITHUB_TOKEN"],
  };
  expect(secretKeys(stdio)).toEqual(["GITHUB_TOKEN"]);
  expect(mcpServerInput(stdio)).toEqual({
    name: "github",
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_TOKEN: null },
  });
  const http = {
    name: "linear",
    type: "http" as const,
    url: "https://mcp.linear.app/mcp",
    headerKeys: ["Authorization"],
  };
  expect(mcpServerInput(http)).toEqual({
    name: "linear",
    type: "http",
    url: "https://mcp.linear.app/mcp",
    headers: { Authorization: null },
  });
});
