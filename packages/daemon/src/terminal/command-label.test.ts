import { expect, it } from "vitest";
import { commandLabel } from "./command-label.ts";

it("names a command as typed, without anything that could be a secret", () => {
  expect(commandLabel("npm run dev")).toBe("npm run dev");
  expect(commandLabel("API_KEY=abc node server.js")).toBe("node server.js");
  expect(commandLabel("A=1 B=2 make watch")).toBe("make watch");
  expect(commandLabel("curl -H 'Authorization: Bearer x' url")).toBe("curl");
  expect(commandLabel("psql --password=hunter2 db")).toBe("psql");
  expect(commandLabel("deploy target=prod")).toBe("deploy");
  expect(commandLabel("git push origin ghp_abcdefghijklmnopqrstuvwxyz0123")).toBe(
    "git push origin",
  );
});

it("keeps paths, names the program by its file, and stays short", () => {
  expect(commandLabel("/usr/local/bin/python3 scripts/serve.py")).toBe("python3 scripts/serve.py");
  expect(commandLabel("-zsh")).toBe("zsh");
  expect(commandLabel("tail -f log.txt")).toBe("tail");
  const long = commandLabel("vite build watch alpha beta gamma delta epsilon zeta");
  expect(long).toBe("vite build watch alpha beta gamma delta");
  expect(long.length).toBeLessThanOrEqual(40);
});

it("says only that a command runs when even its program looks like a secret", () => {
  expect(commandLabel("TOKEN=x")).toBe("A command");
  expect(commandLabel("fake_token_for_tests_only")).toBe("A command");
  expect(commandLabel("")).toBe("A command");
});
