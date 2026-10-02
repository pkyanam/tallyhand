import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Guard: the Codex host (agent-plugin path) hides plugin MCP tools whose
 * serialized model specs exceed a per-plugin byte budget. In Codex CLI/App
 * 0.160.x that budget is 8,000 bytes per tool and 64,000 bytes cumulative
 * across the plugin's tools (codex-rs core/src/mcp_tool_exposure.rs). Tools
 * that overflow are registered but exposed as ToolExposure::Hidden, so the
 * model can neither see nor call them even though /mcp lists them.
 *
 * This test mirrors that host pipeline closely enough to catch catalog growth
 * that would silently drop tools (the alphabetical tail goes first, which is
 * how update_settings and nine other update_* tools disappeared). It asserts
 * the whole catalog fits below the host's 64,000-byte cumulative cap with
 * headroom. If it fails, either shrink specs (server instructions are repeated
 * per tool by the host) or consciously raise the threshold after verifying
 * against a real host.
 */
const { verify } = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("@/lib/auth/oauth", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/auth/oauth")>(),
  verifyTallyOAuth: verify,
}));
import { POST } from "./route";

// Constants mirrored from codex-rs 0.160.x (see docstring).
const HOST_SPEC_BYTES_PER_TOOL = 8_000;
// Keep headroom below the host's 64,000-byte per-plugin cap for future growth;
// tune only with a real-host check.
const ASSERTED_TOTAL_BUDGET = 62_500;

// Host-side descriptions/annotations appended before the budget is computed.
const PLUGIN_SOURCE_NOTE = "This tool is part of plugin `Tallyhand`.";
// Tallyhand MCP server instructions (cli/src/mcp.ts) — repeated per tool by the host.
const SERVER_INSTRUCTIONS = "Read tally://guide. Explicit consent for financial changes, deletes, reset, import. Never request credentials.";
const NAMESPACE = "mcp__tallyhand";

beforeEach(() => {
  vi.stubEnv("APP_BASE_URL", "https://tally.example");
  verify.mockResolvedValue({ userId: "user_catalog_fixture", clientId: "client_fixture", scopes: ["tally:read", "tally:write", "tally:manage"] });
});
afterEach(() => vi.unstubAllEnvs());

const PRIMITIVES = new Set(["string", "number", "boolean", "integer", "object", "array", "null"]);
const COMPOSITION_KEYS = ["anyOf", "oneOf", "allOf"] as const;
const DEFINITION_KEYS = ["$defs", "definitions"] as const;
const byteLen = (s: string) => Buffer.byteLength(s, "utf8");

// Mirrors codex-tools json_schema sanitization: coerce boolean schemas, infer
// missing types, const→enum, then deserialize into the host's JsonSchema subset
// (drops format/min/max/pattern/title and unknown keywords).
function sanitize(value: unknown): void {
  if (typeof value === "boolean") { return; } // handled at call sites via replacement
  if (Array.isArray(value)) { value.forEach(v => sanitize(v)); return; }
  if (value === null || typeof value !== "object") return;
  const map = value as Record<string, unknown>;
  const props = map.properties;
  if (props && typeof props === "object" && !Array.isArray(props)) {
    for (const v of Object.values(props as Record<string, unknown>)) sanitize(v);
  }
  if ("items" in map) sanitize(map.items);
  if ("additionalProperties" in map && typeof map.additionalProperties !== "boolean") sanitize(map.additionalProperties);
  if ("prefixItems" in map) sanitize(map.prefixItems);
  for (const key of COMPOSITION_KEYS) if (key in map) sanitize(map[key]);
  for (const key of DEFINITION_KEYS) {
    const defs = map[key];
    if (defs && typeof defs === "object" && !Array.isArray(defs)) {
      for (const v of Object.values(defs as Record<string, unknown>)) sanitize(v);
    } else {
      delete map[key];
    }
  }
  if ("const" in map) {
    const constValue = map.const;
    delete map.const;
    map.enum = [constValue];
  }
  const typeValue = map.type;
  const types: string[] = typeof typeValue === "string" && PRIMITIVES.has(typeValue) ? [typeValue]
    : Array.isArray(typeValue) ? typeValue.filter((t): t is string => typeof t === "string" && PRIMITIVES.has(t))
    : [];
  if (types.length === 0 && ("$ref" in map || COMPOSITION_KEYS.some(k => k in map))) return;
  if (types.length === 0) {
    if ("properties" in map || "required" in map || "additionalProperties" in map) types.push("object");
    else if ("items" in map || "prefixItems" in map) types.push("array");
    else if ("enum" in map || "format" in map) types.push("string");
    else if (["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"].some(k => k in map)) types.push("number");
    else { for (const k of Object.keys(map)) delete map[k]; return; }
  }
  map.type = types.length === 1 ? types[0] : types;
  if (types.includes("object") && !("properties" in map)) map.properties = {};
  if (types.includes("array") && !("items" in map)) map.items = { type: "string" };
}

// Serializes into the host's JsonSchema field subset and order; throws on
// anything the host would fail to register.
function hostJsonSchema(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof value.$ref === "string") out.$ref = value.$ref;
  if ("type" in value) {
    const t = value.type;
    if (typeof t === "string" && PRIMITIVES.has(t)) out.type = t;
    else if (Array.isArray(t) && t.length > 0 && t.every(x => typeof x === "string" && PRIMITIVES.has(x))) out.type = t;
    else throw new Error(`unserializable type: ${JSON.stringify(t)}`);
  }
  if (typeof value.description === "string") out.description = value.description;
  if (Array.isArray(value.enum)) out.enum = value.enum;
  if ("items" in value) {
    if (!value.items || typeof value.items !== "object" || Array.isArray(value.items)) throw new Error("bad items");
    out.items = hostJsonSchema(value.items as Record<string, unknown>);
  }
  if ("minItems" in value) {
    if (!Number.isInteger(value.minItems) || (value.minItems as number) < 0) throw new Error("bad minItems");
    out.minItems = value.minItems;
  }
  if ("properties" in value) {
    const props = value.properties;
    if (!props || typeof props !== "object" || Array.isArray(props)) throw new Error("bad properties");
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(props as Record<string, unknown>).sort()) {
      sorted[key] = hostJsonSchema((props as Record<string, unknown>)[key] as Record<string, unknown>);
    }
    out.properties = sorted;
  }
  if ("required" in value) {
    if (!Array.isArray(value.required) || !value.required.every(r => typeof r === "string")) throw new Error("bad required");
    out.required = value.required;
  }
  if ("additionalProperties" in value) {
    const ap = value.additionalProperties;
    if (typeof ap === "boolean") out.additionalProperties = ap;
    else if (ap && typeof ap === "object" && !Array.isArray(ap)) out.additionalProperties = hostJsonSchema(ap as Record<string, unknown>);
    else throw new Error("bad additionalProperties");
  }
  for (const key of COMPOSITION_KEYS) {
    if (key in value) {
      if (!Array.isArray(value[key])) throw new Error(`bad ${key}`);
      out[key] = (value[key] as Record<string, unknown>[]).map(v => hostJsonSchema(v));
    }
  }
  for (const key of DEFINITION_KEYS) {
    if (key in value) {
      const defs = value[key];
      if (!defs || typeof defs !== "object" || Array.isArray(defs)) throw new Error(`bad ${key}`);
      const sorted: Record<string, unknown> = {};
      for (const name of Object.keys(defs as Record<string, unknown>).sort()) {
        sorted[name] = hostJsonSchema((defs as Record<string, unknown>)[name] as Record<string, unknown>);
      }
      out[key] = sorted;
    }
  }
  return out;
}

function truncateBytes(str: string, maxBytes: number): string {
  if (byteLen(str) <= maxBytes) return str;
  const buf = Buffer.from(str, "utf8");
  let idx = maxBytes;
  while (idx > 0 && (buf[idx] & 0xc0) === 0x80) idx -= 1;
  return buf.subarray(0, idx).toString("utf8");
}

function annotatedDescription(raw: string | undefined): string {
  const description = (raw ?? "").trim();
  if (description === "") return PLUGIN_SOURCE_NOTE;
  if (/[.!?]$/.test(description)) return `${description} ${PLUGIN_SOURCE_NOTE}`;
  return `${description}. ${PLUGIN_SOURCE_NOTE}`;
}

// Per-tool serialized model spec bytes, mirroring the host pipeline:
// description cap (1,000) → schema sanitize → JsonSchema subset →
// 8,000-byte parameter degrade → namespace spec.
function specBytes(tool: { name: string; description?: string; inputSchema?: unknown }): number {
  const schema = JSON.parse(JSON.stringify(tool.inputSchema ?? {}));
  if (!schema.properties || schema.properties === null) schema.properties = {};
  sanitize(schema);
  const description = truncateBytes(annotatedDescription(tool.description), 1_000);
  const parameters = hostJsonSchema(schema);
  const toolJson = { name: tool.name, description, strict: false, parameters };
  if (byteLen(JSON.stringify(toolJson)) > 8_000) {
    toolJson.parameters = { type: "object", additionalProperties: true };
  }
  const spec = {
    type: "namespace",
    name: NAMESPACE,
    description: truncateBytes(SERVER_INSTRUCTIONS.trim(), 1_000),
    tools: [{ type: "function", ...toolJson }],
  };
  return byteLen(JSON.stringify(spec));
}

describe("agent-plugin model-spec byte budget (Codex host compatibility)", () => {
  it("fits the whole catalog within the host budget with headroom", async () => {
    const response = await POST(new Request("https://tally.example/api/mcp", {
      method: "POST",
      headers: { authorization: "Bearer oat_catalog_fixture", "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }));
    expect(response.status).toBe(200);
    const text = await response.text();
    const payload = text.includes("event-stream")
      ? text.split("\n").filter(l => l.startsWith("data: ")).map(l => JSON.parse(l.slice(6))).find(v => v.id === 1)
      : JSON.parse(text);
    const tools: Array<{ name: string; description?: string; inputSchema?: unknown }> = payload.result.tools;
    expect(tools.length).toBeGreaterThan(0);

    const sizes = tools.map(tool => ({ name: tool.name, bytes: specBytes(tool) }));
    const oversized = sizes.filter(s => s.bytes > HOST_SPEC_BYTES_PER_TOOL);
    expect(oversized).toEqual([]);
    const total = sizes.reduce((sum, s) => sum + s.bytes, 0);
    expect(total).toBeLessThanOrEqual(ASSERTED_TOTAL_BUDGET);
    // Diagnostic output on failure shows the heaviest tools to trim first.
    if (total > ASSERTED_TOTAL_BUDGET) {
      const heaviest = [...sizes].sort((a, b) => b.bytes - a.bytes).slice(0, 8);
      throw new Error(`catalog spec bytes ${total} exceed ${ASSERTED_TOTAL_BUDGET}; heaviest: ${heaviest.map(s => `${s.name}=${s.bytes}`).join(", ")}`);
    }
  });
});
