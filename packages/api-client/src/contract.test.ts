import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  BillingStatusSchema,
  InvoiceListSchema,
  MachineCatalogSchema,
  MachineCostsSchema,
  MachineListSchema,
  MachineResponseSchema,
  MeSchema,
  OrganizationListSchema,
  SshKeyListSchema,
  SshKeyResponseSchema,
} from "./schemas.ts";

/**
 * Contract check against a running control plane: every documented response field must exist in
 * the client's schema and vice versa, so a server change cannot silently drift from this client.
 * Runs only when `CONCORS_API_URL` is set (it needs the network):
 *
 *   CONCORS_API_URL=https://concors-server-dev.up.railway.app pnpm --filter @concors/api-client test
 */
// This package has no Node types on purpose; read the variable without them.
const apiUrl = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env?.["CONCORS_API_URL"];

const ENDPOINTS: readonly [method: string, path: string, status: string, schema: z.ZodObject][] = [
  ["get", "/api/v1/me", "200", MeSchema],
  ["get", "/api/v1/organizations", "200", OrganizationListSchema],
  ["get", "/api/v1/machines/catalog", "200", MachineCatalogSchema],
  ["get", "/api/v1/machines", "200", MachineListSchema],
  ["post", "/api/v1/machines", "201", MachineResponseSchema],
  ["get", "/api/v1/machines/{id}", "200", MachineResponseSchema],
  ["get", "/api/v1/machines/costs", "200", MachineCostsSchema],
  ["get", "/api/v1/ssh-keys", "200", SshKeyListSchema],
  ["post", "/api/v1/ssh-keys", "201", SshKeyResponseSchema],
  ["get", "/api/v1/billing", "200", BillingStatusSchema],
  ["get", "/api/v1/billing/invoices", "200", InvoiceListSchema],
];

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
}

interface OpenApiDocument {
  paths: Record<
    string,
    Record<
      string,
      { responses: Record<string, { content?: Record<string, { schema: JsonSchema }> }> }
    >
  >;
}

/** Property paths (`a.b[].c`) of an OpenAPI schema, ignoring nullability wrappers. */
function documentedPaths(schema: JsonSchema, prefix = ""): string[] {
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants) {
    const object = variants.find((variant) => variant.properties || variant.items);
    return object ? documentedPaths(object, prefix) : [];
  }
  if (schema.items) return documentedPaths(schema.items, `${prefix}[]`);
  return Object.entries(schema.properties ?? {}).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return [path, ...documentedPaths(value, path)];
  });
}

/** The same paths for a Zod schema. */
function clientPaths(schema: z.ZodType, prefix = ""): string[] {
  if (schema instanceof z.ZodNullable || schema instanceof z.ZodOptional) {
    return clientPaths(schema.unwrap() as z.ZodType, prefix);
  }
  if (schema instanceof z.ZodPipe) return clientPaths(schema.in as z.ZodType, prefix);
  if (schema instanceof z.ZodArray) return clientPaths(schema.element as z.ZodType, `${prefix}[]`);
  if (schema instanceof z.ZodObject) {
    return Object.entries(schema.shape as Record<string, z.ZodType>).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return [path, ...clientPaths(value, path)];
    });
  }
  return [];
}

describe.skipIf(!apiUrl)("API contract", () => {
  it("matches the OpenAPI document served by the control plane", async () => {
    const response = await fetch(`${apiUrl!.replace(/\/+$/, "")}/docs/json`);
    expect(response.ok).toBe(true);
    const document = (await response.json()) as OpenApiDocument;

    const drift: string[] = [];
    for (const [method, path, status, schema] of ENDPOINTS) {
      const documented =
        document.paths[path]?.[method]?.responses[status]?.content?.["application/json"]?.schema;
      if (!documented) {
        drift.push(`${method.toUpperCase()} ${path}: not documented`);
        continue;
      }
      const server = new Set(documentedPaths(documented));
      const client = new Set(clientPaths(schema));
      for (const field of server)
        if (!client.has(field)) drift.push(`${path}: client lacks ${field}`);
      for (const field of client)
        if (!server.has(field)) drift.push(`${path}: server lacks ${field}`);
    }
    expect(drift).toEqual([]);
  });
});
