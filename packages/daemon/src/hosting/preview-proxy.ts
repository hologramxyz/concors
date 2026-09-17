import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";
import type { Duplex } from "node:stream";
import type { Socket } from "node:net";
import type { Principal, TokenVerifier } from "../managed/auth.ts";

export const PREVIEW_AUTH_PATH = "/__concors/preview-auth";
const PREVIEW_SCRIPT_PATH = "/__concors/preview-auth.js";
const COOKIE = "__Host-concors_preview";

export interface PreviewTarget {
  port: number;
  protocol: "http" | "https";
}

export function previewTarget(
  request: IncomingMessage,
  machineHostname: string,
  gatewayPort: number,
): PreviewTarget | null {
  const authority = request.headers.host?.toLowerCase();
  if (!authority) return null;
  const host = authority.endsWith(`:${request.socket.localPort}`)
    ? authority.slice(0, -String(request.socket.localPort).length - 1)
    : authority;
  const suffix = `.${machineHostname.toLowerCase()}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  const match = /^(?:(https)-)?(\d{1,5})$/.exec(label);
  const port = Number(match?.[2]);
  if (!match || !Number.isInteger(port) || port < 1 || port > 65535 || port === gatewayPort)
    return null;
  return { port, protocol: match[1] === "https" ? "https" : "http" };
}

export async function previewPrincipal(
  request: IncomingMessage,
  verifier: TokenVerifier,
): Promise<Principal> {
  const token = previewCookie(request);
  if (!token) throw new Error("Unauthorized");
  const principal = await verifier.verify(token);
  if (!Number.isFinite(principal.expiresAt) || principal.expiresAt <= Date.now())
    throw new Error("Unauthorized");
  return principal;
}

export async function authorizePreview(
  request: IncomingMessage,
  response: ServerResponse,
  verifier: TokenVerifier,
): Promise<void> {
  let token = "";
  for await (const chunk of request) {
    token += String(chunk);
    if (token.length > 8192) {
      response.writeHead(413).end();
      return;
    }
  }
  try {
    const principal = await verifier.verify(token);
    const maxAge = Math.max(0, Math.floor((principal.expiresAt - Date.now()) / 1000));
    if (!maxAge) throw new Error("Expired");
    response.setHeader(
      "set-cookie",
      `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`,
    );
    response.writeHead(204).end();
  } catch {
    response.writeHead(401).end();
  }
}

export function servePreviewLogin(request: IncomingMessage, response: ServerResponse): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader(
    "content-security-policy",
    "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  if (new URL(request.url ?? "/", "http://preview").pathname === PREVIEW_SCRIPT_PATH) {
    response
      .writeHead(200, { "content-type": "text/javascript; charset=utf-8" })
      .end(
        `const p=new URLSearchParams(location.hash.slice(1)),t=p.get('access_token'),m=document.querySelector('[data-message]'),u=location.pathname+location.search;history.replaceState(null,'',u);if(!t){m.textContent='Open this preview from Concors.'}else fetch('${PREVIEW_AUTH_PATH}',{method:'POST',headers:{'content-type':'text/plain'},body:t}).then(r=>{if(!r.ok)throw new Error();location.replace(u)}).catch(()=>{m.textContent='Preview access expired. Open it again from Concors.'});`,
      );
    return;
  }
  response
    .writeHead(401, { "content-type": "text/html; charset=utf-8" })
    .end(
      `<!doctype html><meta name="viewport" content="width=device-width"><title>Concors preview</title><style>body{font:16px system-ui;background:#15151b;color:#eee;max-width:420px;margin:15vh auto;padding:24px}h1{font-size:20px}</style><h1>Concors preview</h1><p data-message>Opening preview…</p><script src="${PREVIEW_SCRIPT_PATH}"></script>`,
    );
}

export function proxyPreviewHttp(
  request: IncomingMessage,
  response: ServerResponse,
  target: PreviewTarget,
): void {
  const upstream = previewRequest(target, {
    path: request.url,
    method: request.method,
    headers: previewHeaders(request, target),
  });
  upstream.on("response", (incoming) => {
    response.writeHead(incoming.statusCode ?? 502, incoming.headers);
    incoming.on("error", () => response.destroy());
    incoming.pipe(response);
  });
  upstream.setTimeout(5000, () => upstream.destroy(new Error("Preview connection timed out")));
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502).end("Preview is unavailable.");
    else response.destroy();
  });
  response.once("close", () => upstream.destroy());
  request.on("error", () => upstream.destroy());
  request.pipe(upstream);
}

export function proxyPreviewUpgrade(
  request: IncomingMessage,
  downstream: Duplex,
  head: Buffer,
  target: PreviewTarget,
  sockets: Set<Socket>,
): void {
  downstream.pause();
  const upstream = previewRequest(target, {
    path: request.url,
    method: "GET",
    headers: previewHeaders(request, target),
  });
  const timer = setTimeout(() => upstream.destroy(new Error("Preview connection timed out")), 5000);
  downstream.once("close", () => upstream.destroy());
  upstream.on("error", () => {
    clearTimeout(timer);
    downstream.destroy();
  });
  upstream.on("response", (response) => {
    clearTimeout(timer);
    response.resume();
    downstream.destroy();
  });
  upstream.on("upgrade", (response, socket, upstreamHead) => {
    clearTimeout(timer);
    if (downstream.destroyed) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
      downstream.destroy();
    });
    socket.on("error", () => downstream.destroy());
    downstream.on("error", () => socket.destroy());
    downstream.once("close", () => socket.destroy());
    const headers = response.rawHeaders.reduce<string[]>((result, value, index, all) => {
      if (index % 2 === 0) result.push(`${value}: ${all[index + 1]}`);
      return result;
    }, []);
    downstream.write(`HTTP/1.1 101 Switching Protocols\r\n${headers.join("\r\n")}\r\n\r\n`);
    if (upstreamHead.length) downstream.write(upstreamHead);
    if (head.length) socket.write(head);
    downstream.pipe(socket).pipe(downstream);
    downstream.resume();
  });
  upstream.end();
}

function previewRequest(
  target: PreviewTarget,
  options: {
    path: string | undefined;
    method: string | undefined;
    headers: IncomingHttpHeaders;
  },
) {
  return (target.protocol === "https" ? httpsRequest : httpRequest)({
    host: "127.0.0.1",
    port: target.port,
    ...options,
    ...(target.protocol === "https" ? { rejectUnauthorized: false } : {}),
  });
}

function previewHeaders(request: IncomingMessage, target: PreviewTarget): IncomingHttpHeaders {
  const headers = { ...request.headers };
  headers.host = `localhost:${target.port}`;
  delete headers.authorization;
  delete headers["sec-websocket-protocol"];
  const cookie = stripPreviewCookie(request.headers.cookie);
  if (cookie) headers.cookie = cookie;
  else delete headers.cookie;
  headers["x-forwarded-host"] = request.headers.host ?? "";
  headers["x-forwarded-proto"] = "https";
  return headers;
}

function previewCookie(request: IncomingMessage): string | null {
  const value = request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!value || value.length > 8192) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function stripPreviewCookie(value: string | undefined): string | undefined {
  return value
    ?.split(";")
    .map((part) => part.trim())
    .filter((part) => !part.startsWith(`${COOKIE}=`))
    .join("; ");
}
