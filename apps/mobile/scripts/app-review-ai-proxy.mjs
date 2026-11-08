/** Review-host operator service. This file is never imported by the mobile application. */
import http from "node:http";
import fs from "node:fs";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { timingSafeEqual } from "node:crypto";
const MODEL = "claude-haiku-4-5-20251001";
const MAX_BYTES = 65536;
const LIMIT_CENTS = 2000;
const RESERVATION_CENTS = 25;

function normalizeRequest(input) {
  if (!input || input.model !== MODEL || !Array.isArray(input.messages))
    throw Error("Unsupported review model");
  // Text-only requests and custom tools avoid separately billed hosted tools and image processing.
  const strip = (value) => {
    if (Array.isArray(value)) return value.map(strip);
    if (!value || typeof value !== "object") return value;
    if (["image", "document", "web_search_tool_result", "server_tool_use"].includes(value.type))
      throw Error("Unsupported review content");
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "cache_control")
        .map(([key, item]) => [key, strip(item)]),
    );
  };
  const extraBillingOptions = [
    "service_tier",
    "inference_geo",
    "speed",
    "container",
    "context_management",
  ];
  const body = Object.fromEntries(
    Object.entries(strip(input)).filter(([key]) => !extraBillingOptions.includes(key)),
  );
  if (body.tools?.some((tool) => tool.type && tool.type !== "custom"))
    throw Error("Hosted tools are unavailable");
  if (body.thinking && body.thinking.type !== "disabled")
    throw Error("Thinking is disabled for this review model");
  body.max_tokens = Math.min(
    Number.isSafeInteger(body.max_tokens) && body.max_tokens > 0 ? body.max_tokens : 2048,
    2048,
  );
  const encoded = JSON.stringify(body);
  if (Buffer.byteLength(encoded) > MAX_BYTES)
    throw Error("Review context is full; start a new chat");
  return encoded;
}

function reserve(file, now = new Date()) {
  const month = now.toISOString().slice(0, 7);
  let ledger = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : { month, reservedCents: 0, requests: 0 };
  if (ledger.month !== month) ledger = { month, reservedCents: 0, requests: 0 };
  if (!Number.isSafeInteger(ledger.reservedCents) || ledger.reservedCents < 0)
    throw Error("Invalid review budget state");
  if (ledger.reservedCents + RESERVATION_CENTS > LIMIT_CENTS) return null;
  ledger.reservedCents += RESERVATION_CENTS;
  ledger.requests++;
  // Book the conservative maximum before sending; failures and disconnected streams are not refunded.
  fs.writeFileSync(file + ".new", JSON.stringify(ledger) + "\n", { mode: 0o600 });
  fs.renameSync(file + ".new", file);
  return ledger;
}

function serve(config, ledgerFile) {
  return http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://127.0.0.1").pathname;
    const send = (status, message) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message } }));
    };
    if (req.method === "GET" && pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(JSON.stringify({ ready: true, model: MODEL, monthlyBudgetUSD: 20 }));
    }
    const supplied = String(
      req.headers["x-api-key"] ?? String(req.headers.authorization ?? "").replace(/^Bearer /, ""),
    );
    const expected = config.localToken;
    if (
      Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    )
      return send(401, "Review AI authentication required");
    if (
      req.method !== "POST" ||
      !["/v1/messages", "/messages", "/v1/v1/messages"].includes(pathname)
    )
      return send(404, "Review AI route unavailable");
    let size = 0,
      chunks = [];
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BYTES) return send(413, "Review context is full; start a new chat");
        chunks.push(chunk);
      }
      let body;
      try {
        body = normalizeRequest(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        return send(400, "Use the configured text review model and a shorter chat");
      }
      if (!reserve(ledgerFile))
        return send(429, "The review AI allowance has been reached. Contact gm@hologram.xyz.");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120000);
      res.on("close", () => controller.abort());
      try {
        const upstream = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": config.upstreamKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body,
          signal: controller.signal,
        });
        if (!upstream.ok) {
          await upstream.body?.cancel();
          return send(
            upstream.status,
            "Review AI provider request failed; contact gm@hologram.xyz.",
          );
        }
        res.writeHead(upstream.status, {
          "content-type": upstream.headers.get("content-type") ?? "application/json",
          "cache-control": "no-store",
        });
        for await (const chunk of upstream.body) {
          if (!res.destroyed) res.write(chunk);
        }
        res.end();
      } finally {
        clearTimeout(timer);
      }
    } catch {
      if (!res.headersSent) send(503, "Review AI temporarily unavailable");
      else res.destroy();
    }
  });
}

export { normalizeRequest, reserve, serve, MODEL, MAX_BYTES, LIMIT_CENTS, RESERVATION_CENTS };
if (
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
) {
  const config = JSON.parse(fs.readFileSync("/etc/concors-review-ai/credentials.json", "utf8"));
  if (!config.upstreamKey || !config.localToken) throw Error("Review AI credentials missing");
  serve(config, "/var/lib/concors-review-ai/budget.json").listen(43189, "127.0.0.1");
}
