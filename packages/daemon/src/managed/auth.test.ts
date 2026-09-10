import { generateKeyPairSync } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import { generateKeyPair, createLocalJWKSet, exportJWK, importPKCS8, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";

import { createTokenVerifier, TokenError, tokenFromRequest } from "./auth.ts";

const CONTROL_PLANE = "https://api.example.test";
const MACHINE = "machine_1";

async function signer() {
  const pem = generateKeyPairSync("ed25519").privateKey.export({
    type: "pkcs8",
    format: "pem",
  }) as string;
  const key = await importPKCS8(pem, "EdDSA", { extractable: true });
  const jwk = await exportJWK(key);
  delete jwk.d;
  const jwks = createLocalJWKSet({ keys: [{ ...jwk, kid: "k1", alg: "EdDSA" }] });
  const sign = (
    claims: Record<string, unknown>,
    overrides: { aud?: string; iss?: string; exp?: string } = {},
  ) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "EdDSA", kid: "k1" })
      .setIssuer(overrides.iss ?? CONTROL_PLANE)
      .setAudience(overrides.aud ?? MACHINE)
      .setIssuedAt()
      .setJti("token_1")
      .setExpirationTime(overrides.exp ?? "15m")
      .sign(key);
  return { jwks, sign };
}

describe("createTokenVerifier", () => {
  it("accepts a token for this machine and returns the principal", async () => {
    const { jwks, sign } = await signer();
    const verifier = createTokenVerifier({
      controlPlaneUrl: CONTROL_PLANE,
      machineId: MACHINE,
      getKey: jwks,
    });

    const token = await sign({ sid: "session_1", org: "org_1", sub: "user_1" });

    await expect(verifier.verify(token)).resolves.toEqual({
      userId: "user_1",
      sessionId: "session_1",
      organizationId: "org_1",
    });
  });

  it.each([
    ["another machine", { aud: "machine_2" }],
    ["another issuer", { iss: "https://evil.example" }],
    ["expired", { exp: "-1m" }],
  ])("rejects a token for %s", async (_label, overrides) => {
    const { jwks, sign } = await signer();
    const verifier = createTokenVerifier({
      controlPlaneUrl: CONTROL_PLANE,
      machineId: MACHINE,
      getKey: jwks,
    });

    const token = await sign({ sid: "s", org: "o", sub: "u" }, overrides);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(TokenError);
  });

  it("rejects a token signed by another key and garbage", async () => {
    const { jwks } = await signer();
    const other = await signer();
    const verifier = createTokenVerifier({
      controlPlaneUrl: CONTROL_PLANE,
      machineId: MACHINE,
      getKey: jwks,
    });

    await expect(
      verifier.verify(await other.sign({ sid: "s", org: "o", sub: "u" })),
    ).rejects.toBeInstanceOf(TokenError);
    await expect(verifier.verify("not.a.jwt")).rejects.toBeInstanceOf(TokenError);
  });

  it("rejects a token without the scoping claims", async () => {
    const { jwks, sign } = await signer();
    const verifier = createTokenVerifier({
      controlPlaneUrl: CONTROL_PLANE,
      machineId: MACHINE,
      getKey: jwks,
    });

    await expect(verifier.verify(await sign({ sub: "u" }))).rejects.toBeInstanceOf(TokenError);
  });
});

describe("tokenFromRequest", () => {
  const request = (headers: Record<string, string>, url = "/sessions") =>
    ({ headers, url }) as unknown as IncomingMessage;

  it("reads the bearer header first, then the query string", () => {
    expect(tokenFromRequest(request({ authorization: "Bearer abc" }))).toBe("abc");
    expect(tokenFromRequest(request({ authorization: "bearer   abc" }))).toBe("abc");
    expect(tokenFromRequest(request({}, "/sessions/x/attach?token=qs"))).toBe("qs");
    expect(tokenFromRequest(request({ authorization: "Bearer h" }, "/x?token=qs"))).toBe("h");
    expect(tokenFromRequest(request({ authorization: "Basic zzz" }))).toBeNull();
    expect(tokenFromRequest(request({}))).toBeNull();
  });
});

it.each(["sub", "sid", "org", "iat", "exp", "jti", "iss", "aud"])(
  "rejects a missing %s claim",
  async (claim) => {
    const { privateKey, publicKey } = await generateKeyPair("EdDSA");
    const jwk = await exportJWK(publicKey);
    const payload: Record<string, unknown> = {
      sub: "u",
      sid: "s",
      org: "o",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900,
      jti: "j",
      iss: CONTROL_PLANE,
      aud: MACHINE,
    };
    const claims = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== claim));
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: "EdDSA", kid: "k" })
      .sign(privateKey);
    const verifier = createTokenVerifier({
      controlPlaneUrl: CONTROL_PLANE,
      machineId: MACHINE,
      getKey: createLocalJWKSet({ keys: [{ ...jwk, kid: "k" }] }),
    });
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(TokenError);
  },
);

it.each(["sub", "sid", "org"])("rejects an empty or non-string %s", async (claim) => {
  const { jwks, sign } = await signer();
  const verifier = createTokenVerifier({
    controlPlaneUrl: CONTROL_PLANE,
    machineId: MACHINE,
    getKey: jwks,
  });
  for (const value of ["", 42]) {
    await expect(
      verifier.verify(await sign({ sub: "u", sid: "s", org: "o", [claim]: value })),
    ).rejects.toBeInstanceOf(TokenError);
  }
});

it("prefers the bearer subprotocol to headers and query tokens", () => {
  const request = {
    headers: {
      "sec-websocket-protocol": "other, concors.bearer.browser",
      authorization: "Bearer header",
    },
    url: "/ws?token=query",
  } as IncomingMessage;
  expect(tokenFromRequest(request)).toBe("browser");
  request.headers["sec-websocket-protocol"] = "concors.bearer.";
  expect(tokenFromRequest(request)).toBe("");
});

it("caches JWKS offline and refreshes unknown kids after the 30-second cooldown", async () => {
  const first = await generateKeyPair("EdDSA");
  const second = await generateKeyPair("EdDSA");
  let keys = [{ ...(await exportJWK(first.publicKey)), kid: "first", alg: "EdDSA" }];
  let requests = 0;
  let available = true;
  const server = createServer((req, res) => {
    expect(req.url).toBe("/.well-known/jwks.json");
    requests++;
    if (!available) {
      res.writeHead(503).end();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const issuer = `http://127.0.0.1:${address.port}`;
  const verifier = createTokenVerifier({ controlPlaneUrl: issuer, machineId: MACHINE });
  const sign = (kid: string, key: CryptoKey) =>
    new SignJWT({ sub: "u", sid: "s", org: "o" })
      .setProtectedHeader({ alg: "EdDSA", kid })
      .setIssuer(issuer)
      .setAudience(MACHINE)
      .setIssuedAt()
      .setExpirationTime("15m")
      .setJti("j")
      .sign(key);
  try {
    const a = await sign("first", first.privateKey);
    await verifier.verify(a);
    available = false;
    await verifier.verify(a);
    expect(requests).toBe(1);
    const b = await sign("second", second.privateKey);
    await expect(verifier.verify(b)).rejects.toBeInstanceOf(TokenError);
    expect(requests).toBe(1);
    available = true;
    keys = [...keys, { ...(await exportJWK(second.publicKey)), kid: "second", alg: "EdDSA" }];
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 30_001);
    await verifier.verify(b);
    expect(requests).toBe(2);
  } finally {
    vi.restoreAllMocks();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("rejects missing kid, invalid jti and non-EdDSA signatures", async () => {
  for (const alg of ["EdDSA", "ES256"]) {
    const { privateKey, publicKey } = await generateKeyPair(alg);
    const verifier = createTokenVerifier({
      controlPlaneUrl: CONTROL_PLANE,
      machineId: MACHINE,
      getKey: createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k" }] }),
    });
    const token = (kid: string | undefined, jti: unknown) =>
      new SignJWT({ sub: "u", sid: "s", org: "o", jti } as Record<string, unknown>)
        .setProtectedHeader({ alg, ...(kid ? { kid } : {}) })
        .setIssuer(CONTROL_PLANE)
        .setAudience(MACHINE)
        .setIssuedAt()
        .setExpirationTime("15m")
        .sign(privateKey);
    await expect(verifier.verify(await token(undefined, "j"))).rejects.toBeInstanceOf(TokenError);
    await expect(verifier.verify(await token("k", ""))).rejects.toBeInstanceOf(TokenError);
    await expect(verifier.verify(await token("k", 42))).rejects.toBeInstanceOf(TokenError);
    if (alg !== "EdDSA")
      await expect(verifier.verify(await token("k", "j"))).rejects.toBeInstanceOf(TokenError);
  }
});
