import type { FastifyInstance } from "fastify";
import { TriggerHttpError, type TriggerManager } from "./manager.ts";

/** Scoped parser preserves arbitrary webhook payloads without changing the host's other routes. */
export function registerTriggerHttp(app: FastifyInstance, manager: TriggerManager) {
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      "*",
      { parseAs: "buffer", bodyLimit: 65536 },
      (_request, body, done) => done(null, body),
    );
    scope.post<{ Params: { triggerId: string }; Querystring: { source?: string } }>(
      "/hooks/:triggerId",
      { bodyLimit: 65536 },
      async (request, reply) => {
        const header = (name: string) => {
          const v = request.headers[name];
          return typeof v === "string" ? v : undefined;
        };
        const credential = header("x-concors-webhook-secret") ?? header("authorization") ?? "";
        const secret = /^Bearer (.+)$/i.exec(credential)?.[1] ?? "";
        const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        let body = raw.toString("utf8");
        if (header("content-type")?.split(";")[0]?.trim().toLowerCase() === "application/json") {
          try {
            const pretty = JSON.stringify(JSON.parse(body), null, 2);
            if (Buffer.byteLength(pretty) <= 65536) body = pretty;
          } catch {
            /* Invalid JSON is still external data. */
          }
        }
        try {
          const { duplicate, event } = manager.accept(
            request.params.triggerId,
            secret,
            body,
            raw.byteLength,
            header("x-concors-source") ||
              (typeof request.query.source === "string" ? request.query.source : undefined),
            header("idempotency-key"),
          );
          return reply
            .code(duplicate ? 200 : 202)
            .send({ eventId: event.id, status: event.status, sessionId: event.sessionId });
        } catch (error) {
          if (error instanceof TriggerHttpError)
            return reply.code(error.statusCode).send({ error: error.message });
          throw error;
        }
      },
    );
  });
}
