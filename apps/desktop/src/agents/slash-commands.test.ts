import { expect, it } from "vitest";
import type { AgentCommand } from "@concors/protocol";
import { matchCommands, needsArguments, slashQuery } from "./slash-commands";

const command = (name: string, argumentHint?: string): AgentCommand => ({
  name,
  description: "",
  kind: "command",
  ...(argumentHint ? { argumentHint } : {}),
});

it("offers commands only while a bare command name is being typed", () => {
  expect(slashQuery("/")).toBe("");
  expect(slashQuery("/comp")).toBe("comp");
  expect(slashQuery("/review:pr")).toBe("review:pr");
  expect(slashQuery("/compact now")).toBeNull();
  expect(slashQuery(" /compact")).toBeNull();
  expect(slashQuery("please /compact")).toBeNull();
  expect(slashQuery("")).toBeNull();
});

it("ranks prefix matches before other matches and keeps the provider's order", () => {
  const commands = [command("review"), command("compact"), command("autocompact")];
  expect(matchCommands(commands, "").map((c) => c.name)).toEqual([
    "review",
    "compact",
    "autocompact",
  ]);
  expect(matchCommands(commands, "COMP").map((c) => c.name)).toEqual(["compact", "autocompact"]);
  expect(matchCommands(commands, "zzz")).toEqual([]);
});

it("runs a command directly unless it names a required argument", () => {
  expect(needsArguments(command("compact"))).toBe(false);
  expect(needsArguments(command("compact", "[instructions]"))).toBe(false);
  expect(needsArguments(command("review", "<target>"))).toBe(true);
  expect(needsArguments(command("review", "  "))).toBe(false);
});
