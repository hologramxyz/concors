import { z } from "zod";
import type { AgentQuestion } from "@concors/protocol";
const record = (v: unknown) => z.record(z.string(), z.unknown()).parse(v ?? {});
/** MCP form fields are primitive values or string selections, never executable UI. */
export function elicitationQuestions(schema: unknown): AgentQuestion[] {
  const form = record(schema),
    required = Array.isArray(form["required"]) ? form["required"] : [];
  return Object.entries(record(form["properties"])).map(([id, raw]) => {
    const p = record(raw),
      array = p["type"] === "array",
      items = array ? record(p["items"]) : p;
    const choices = Array.isArray(items["enum"])
      ? items["enum"]
      : p["type"] === "boolean"
        ? [true, false]
        : [];
    if (
      !["string", "integer", "number", "boolean", "array"].includes(String(p["type"])) ||
      (array && !choices.length)
    )
      throw new Error("This MCP form requires a field type not supported by this client.");
    return {
      id,
      header: String(p["title"] ?? id),
      question:
        String(p["title"] ?? id) + (p["description"] ? `: ${String(p["description"])}` : ""),
      isSecret: p["format"] === "password",
      required: required.includes(id),
      multiSelect: array,
      allowOther: !choices.length,
      options: choices.length
        ? choices.map((value) => ({ label: String(value), description: "" }))
        : null,
    };
  });
}
export function elicitationContent(
  schema: unknown,
  answers: Record<string, string[]>,
): Record<string, string | number | boolean | string[]> {
  const form = record(schema),
    result: Record<string, string | number | boolean | string[]> = {};
  const required = Array.isArray(form["required"]) ? form["required"] : [];
  for (const [id, raw] of Object.entries(record(form["properties"]))) {
    const p = record(raw),
      values = answers[id] ?? [],
      first = values[0];
    if (!values.length || first === undefined) {
      if (required.includes(id)) throw new Error(`Answer ${id}`);
      continue;
    }
    let value: string | number | boolean | string[];
    if (p["type"] === "boolean") {
      if (!["true", "false"].includes(first)) throw new Error(`Choose true or false for ${id}`);
      value = first === "true";
    } else if (p["type"] === "integer" || p["type"] === "number") {
      value = Number(first);
      if (
        !Number.isFinite(value) ||
        (p["type"] === "integer" && !Number.isInteger(value)) ||
        (typeof p["minimum"] === "number" && value < p["minimum"]) ||
        (typeof p["maximum"] === "number" && value > p["maximum"])
      )
        throw new Error(`Enter a valid ${String(p["type"])} for ${id}`);
    } else value = p["type"] === "array" ? values : first;
    const choices = p["type"] === "array" ? record(p["items"])["enum"] : p["enum"];
    if (
      Array.isArray(choices) &&
      !(Array.isArray(value) ? value : [value]).every((v) => choices.includes(v))
    )
      throw new Error(`Choose an available value for ${id}`);
    if (
      typeof value === "string" &&
      ((typeof p["minLength"] === "number" && value.length < p["minLength"]) ||
        (typeof p["maxLength"] === "number" && value.length > p["maxLength"]))
    )
      throw new Error(`Check the length of ${id}`);
    result[id] = value;
  }
  return result;
}
