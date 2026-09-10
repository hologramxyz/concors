import type { IncomingMessage } from "node:http";

import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

/*
 * Who may talk to this agent: holders of a machine token minted by the
 * control plane (see lib/machine-tokens.ts there). Tokens are verified
 * offline against the control plane's JWK Set, cached by jose and refreshed
 * when an unknown key id shows up, so the machine stays reachable while the
 * control plane is not.
 */

const ALG = "EdDSA";

export interface Principal {
  userId: string;
  /** Login session (= device) the token was minted for. */
  sessionId: string;
  organizationId: string;
  /** Absolute deadline for every authenticated transport, not just its upgrade. */
  expiresAt: number;
}

export interface TokenVerifier {
  verify(token: string): Promise<Principal>;
}

export class TokenError extends Error {
  override readonly name = "TokenError";
}

export interface TokenVerifierOptions {
  controlPlaneUrl: string;
  machineId: string;
  /** Key source; defaults to the control plane's `/.well-known/jwks.json`. */
  getKey?: JWTVerifyGetKey;
}

export function createTokenVerifier(options: TokenVerifierOptions): TokenVerifier {
  const getKey =
    options.getKey ??
    createRemoteJWKSet(new URL(`${options.controlPlaneUrl}/.well-known/jwks.json`), {
      cooldownDuration: 30_000,
      cacheMaxAge: 60 * 60 * 1000,
    });

  return {
    async verify(token) {
      let payload: JWTPayload;
      try {
        const result = await jwtVerify(token, getKey, {
          algorithms: [ALG],
          issuer: options.controlPlaneUrl,
          audience: options.machineId,
          requiredClaims: ["sub", "sid", "org", "iat", "exp", "jti"],
        });
        if (typeof result.protectedHeader.kid !== "string" || !result.protectedHeader.kid)
          throw new TokenError("token is missing kid");
        payload = result.payload;
      } catch (error) {
        throw new TokenError(error instanceof Error ? error.message : "invalid token");
      }
      const { sub, sid, org } = payload;
      if (
        typeof sub !== "string" ||
        !sub ||
        typeof sid !== "string" ||
        !sid ||
        typeof org !== "string" ||
        !org
      ) {
        throw new TokenError("token is missing sub, sid or org");
      }
      if (typeof payload.jti !== "string" || !payload.jti)
        throw new TokenError("token is missing jti");
      if (
        typeof payload.exp !== "number" ||
        typeof payload.iat !== "number" ||
        !Number.isFinite(payload.exp) ||
        !Number.isFinite(payload.iat) ||
        payload.exp <= payload.iat ||
        payload.exp - payload.iat > 900 ||
        payload.iat > Date.now() / 1000 + 30
      )
        throw new TokenError("token lifetime exceeds the machine access policy");
      return { userId: sub, sessionId: sid, organizationId: org, expiresAt: payload.exp * 1000 };
    },
  };
}

/**
 * Browser subprotocol first, then Authorization, then query string as a last resort.
 */
export function tokenFromRequest(request: IncomingMessage): string | null {
  const protocol = bearerProtocol(request);
  if (protocol) return protocol.slice("concors.bearer.".length);
  const header = request.headers.authorization;
  if (header) {
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (match) return match[1] ?? null;
  }
  const url = new URL(request.url ?? "/", "http://daemon");
  return url.searchParams.get("token");
}

export function bearerProtocol(request: IncomingMessage): string | undefined {
  return request.headers["sec-websocket-protocol"]
    ?.split(",")
    .map((value) => value.trim())
    .find((value) => value.startsWith("concors.bearer."));
}
