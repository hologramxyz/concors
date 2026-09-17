import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ScheduleRequestSchema, type AgentInfo, type ScheduleResult } from "@concors/protocol";
import type { ScheduleManager } from "./manager.ts";
import type { AgentToolContext } from "../agents/providers/index.ts";

/** A separate, loopback-only, session-scoped credential. Never exposes the gateway bearer.
 * MCP-capable providers get a native tool; shell-based adapters use the same JSON endpoint. */
export class ScheduleTools {
  private readonly tokens = new Map<string, { sessionId: string; projectId: string }>();
  private readonly sessions = new Map<string, string>();
  private origin = "";
  private readonly server = createServer((req, res) => {
    void this.handle(req, res);
  });
  private manager: ScheduleManager | undefined;
  async start(manager: ScheduleManager) {
    this.manager = manager;
    this.server.requestTimeout = 10000;
    this.server.headersTimeout = 10000;
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Schedule tools could not start");
    this.origin = `http://127.0.0.1:${address.port}`;
  }
  context(agent: AgentInfo): AgentToolContext {
    if (!this.origin) return {};
    let token = this.sessions.get(agent.id);
    if (!token) {
      token = randomBytes(32).toString("hex");
      this.sessions.set(agent.id, token);
      this.tokens.set(token, { sessionId: agent.id, projectId: agent.projectId });
    }
    return {
      mcp: {
        name: "concors-schedules",
        type: "http",
        url: this.origin + "/mcp",
        headers: { Authorization: `Bearer ${token}` },
      },
      env: { CONCORS_SCHEDULE_URL: this.origin + "/schedules", CONCORS_SCHEDULE_TOKEN: token },
      instructions: `Concors schedules are available on this machine. Only create or change schedules when the user asks. Use the concors_schedules MCP tool if available. Otherwise, send JSON with curl to "$CONCORS_SCHEDULE_URL" using the Authorization header "Bearer $CONCORS_SCHEDULE_TOKEN" and Content-Type: application/json. Never print the token. Request shape: {"type":"schedule.request","requestId":"<new UUID; reuse for retries>","operation":{"kind":"list"}}. To create, operation is {"kind":"create","schedule":{"name":"...","projectId":"${agent.projectId}","prompt":"...","target":{"kind":"session","sessionId":"${agent.id}"},"cadence":{"kind":"daily","time":"09:00","timezone":"<user's IANA timezone>"},"enabled":true}}. Cadence may instead be {"kind":"interval","minutes":60} (minimum 15), or weekly with time, timezone and days [0-6; Sunday=0]. List before creating to avoid duplicates. Ask if the cadence or timezone is unclear. A schedule reuses its session, runs only while this machine is on, skips busy sessions and never replays missed runs. Native provider cron tools do not register Concors schedules.`,
    };
  }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      const scope = this.tokens.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
      if (!scope || req.headers.origin || req.headers.host !== new URL(this.origin).host) {
        send(401, { error: "Unauthorized" });
        return;
      }
      if (req.method !== "POST" || !["/mcp", "/schedules"].includes(req.url ?? "")) {
        send(405, { error: "POST required" });
        return;
      }
      let bytes = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 65536) {
          send(413, { error: "Request too large" });
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const execute = (raw: unknown): ScheduleResult => {
        const request = ScheduleRequestSchema.parse(raw),
          op = request.operation;
        if (!this.manager) throw new Error("Schedules are unavailable");
        if (
          (op.kind === "create" || op.kind === "update") &&
          op.schedule.projectId !== scope.projectId
        )
          throw new Error("This tool can only manage schedules in its own workspace");
        if (
          "id" in op &&
          this.manager.list().find((s) => s.id === op.id)?.projectId !== scope.projectId
        )
          throw new Error("Schedule is not in this workspace");
        const result = this.manager.request(request, "agent");
        if (result.outcome.status === "ok")
          result.outcome.schedules = result.outcome.schedules.filter(
            (s) => s.projectId === scope.projectId,
          );
        return result;
      };
      if (req.url === "/schedules") {
        send(200, execute(body));
        return;
      }
      const mcp = new McpServer({ name: "concors-schedules", version: "1.0.0" });
      mcp.registerTool(
        "concors_schedules",
        {
          description: `List, create, edit, pause or delete persistent Concors schedules when the user requests it. Current projectId: ${scope.projectId}; current sessionId: ${scope.sessionId}. List before creating. Reuse requestId for retries. Schedule prompts retain normal tool approvals; busy and missed runs are skipped. For pause, update the definition with enabled:false. These schedules appear in the Concors Schedules page.`,
          inputSchema: ScheduleRequestSchema,
        },
        async (args) => {
          try {
            const result = execute(args);
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
              isError: result.outcome.status === "error",
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: error instanceof Error ? error.message : "Schedule request failed",
                },
              ],
              isError: true,
            };
          }
        },
      );
      const transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
      });
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      // SDK transport accessors include undefined; its Transport interface uses optional properties.
      await mcp.connect(transport as Parameters<McpServer["connect"]>[0]);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (!res.headersSent)
        send(400, { error: error instanceof Error ? error.message : "Invalid schedule request" });
      else res.end();
    }
  }
  async close() {
    this.tokens.clear();
    this.sessions.clear();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
