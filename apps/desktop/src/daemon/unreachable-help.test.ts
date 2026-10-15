import { expect, it } from "vitest";
import { unreachableHelp } from "./unreachable-help";

it("tells a running own server from one that stopped, by its last heartbeat", () => {
  const running = unreachableHelp({ kind: "own", relayed: false, seenAgo: 20_000 });
  expect(running.status).toContain("The machine is running");
  expect(running.causes.join(" ")).toContain("port 443");
  const stopped = unreachableHelp({ kind: "own", relayed: false, seenAgo: 3 * 60 * 60_000 });
  expect(stopped.status).toBe(
    "The machine has not checked in with Concors for 3 hours. It is probably off, restarting, or out of memory.",
  );
  expect(unreachableHelp({ kind: "own", relayed: false, seenAgo: null }).status).toBeNull();
});

it("gives an own server the commands that show what happened, with the relay tunnel when used", () => {
  const direct = unreachableHelp({ kind: "own", relayed: false, seenAgo: null });
  expect(direct.commands).toContain("systemctl status concors-gateway concors-session-host");
  expect(direct.commands).toContain("journalctl -u concors-gateway -u concors-session-host");
  expect(direct.commands).toContain("free -m");
  expect(direct.commands).not.toContain("concors-tunnel");
  const relayed = unreachableHelp({ kind: "own", relayed: true, seenAgo: null });
  expect(relayed.commands).toContain("systemctl status concors-tunnel");
  expect(relayed.causes.join(" ")).toContain("tunnel to the Concors relay");
});

it("asks nothing technical for a Concors machine or this computer", () => {
  const concors = unreachableHelp({ kind: "concors", relayed: false, seenAgo: 10 * 60_000 });
  expect(concors.commands).toBeNull();
  expect(concors.causes.join(" ")).toContain("installing an update");
  const local = unreachableHelp({ kind: "local", relayed: false, seenAgo: null });
  expect(local.commands).toBeNull();
  expect(local.causes.join(" ")).toContain("Quit Concors and open it again");
});
