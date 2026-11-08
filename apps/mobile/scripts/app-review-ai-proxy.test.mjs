import { test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { normalizeRequest, reserve, serve, MODEL } from "./app-review-ai-proxy.mjs";
const request = () => ({
  model: MODEL,
  max_tokens: 10000,
  messages: [{ role: "user", content: "Review the fictional sample." }],
});
test("pins billable features, output and body size before any send", () => {
  const body = request();
  body.messages[0].cache_control = { type: "ephemeral", ttl: "1h" };
  body.service_tier = "priority";
  const result = JSON.parse(normalizeRequest(body));
  assert.equal(result.max_tokens, 2048);
  assert(!result.messages[0].cache_control);
  assert(!result.service_tier);
  assert.throws(() => normalizeRequest({ ...request(), model: "claude-opus-5" }));
  assert.throws(() => normalizeRequest({ ...request(), tools: [{ type: "web_search_20250305" }] }));
  assert.throws(() =>
    normalizeRequest({ ...request(), messages: [{ role: "user", content: [{ type: "image" }] }] }),
  );
  assert.throws(() =>
    normalizeRequest({ ...request(), messages: [{ role: "user", content: "a".repeat(66000) }] }),
  );
});
test("reserves all 80 requests durably and refuses any extra spend across restart", () => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "concors-review-budget-")),
    file = path.join(dir, "budget.json");
  try {
    for (let n = 0; n < 80; n++) assert(reserve(file, new Date("2026-11-08Z")));
    assert.equal(reserve(file, new Date("2026-11-09Z")), null);
    assert.equal(JSON.parse(fs.readFileSync(file)).reservedCents, 2000);
    assert(reserve(file, new Date("2026-12-01Z")));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
test("health, unauthenticated and unsupported routes cannot consume budget or send upstream", async () => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "concors-review-budget-")),
    file = path.join(dir, "budget.json");
  const server = serve({ localToken: "local-test-token", upstreamKey: "unused" }, file);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    assert.equal((await fetch(base + "/health")).status, 200);
    assert.equal((await fetch(base + "/v1/messages", { method: "POST", body: "{}" })).status, 401);
    assert.equal(
      (await fetch(base + "/v1/keys", { headers: { "x-api-key": "local-test-token" } })).status,
      404,
    );
    assert.equal(
      (
        await fetch(base + "/v1/messages?beta=true", {
          method: "POST",
          headers: { "x-api-key": "local-test-token" },
          body: "{}",
        })
      ).status,
      400,
    );
    assert(!fs.existsSync(file));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true });
  }
});
