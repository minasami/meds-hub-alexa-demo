import { afterEach, describe, expect, it, vi } from "vitest";
import { createIpRateLimiter, normalizeIp, vercelClientIp } from "../server/rateLimit.js";
import { POST as toolPost } from "../api/tool.js";
import { POST as initializePost } from "../api/initialize.js";
import { McpClient, type TraceEntry } from "../server/mcpClient.js";
import { createInitializeHandler, createToolHandler } from "../server/api.js";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const request = (ip: string, route = "tool", body = '{"name":"get_disclaimer"}') => new Request(`https://demo.test/api/${route}`, {
  method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body,
});
function fakeMcp() {
  return vi.fn(async (_url: any, options: any) => {
    const message = JSON.parse(options.body);
    if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: "2.0", id: message.id, result: message.method === "initialize"
      ? { protocolVersion: "2025-11-25" } : { structuredContent: { public: true } } });
  });
}

describe("bounded per-IP rate limiting", () => {
  it("isolates IPs/routes, returns retry time, and resets after the window", () => {
    let now = 0;
    const consume = createIpRateLimiter({ toolLimit: 2, initializeLimit: 1, windowMs: 10000, now: () => now });
    expect(consume("192.0.2.1", "tool").allowed).toBe(true);
    expect(consume("192.0.2.1", "tool").allowed).toBe(true);
    expect(consume("192.0.2.1", "tool")).toEqual({ allowed: false, retryAfter: 10 });
    expect(consume("192.0.2.2", "tool").allowed).toBe(true);
    expect(consume("192.0.2.1", "initialize").allowed).toBe(true);
    expect(consume("192.0.2.1", "initialize").allowed).toBe(false);
    now = 10000;
    expect(consume("192.0.2.1", "tool").allowed).toBe(true);
  });
  it("normalizes IPv6, groups invalid IPs, and bounds active counter storage", () => {
    expect(normalizeIp("2001:db8:0:0:0:0:0:1")).toBe(normalizeIp("2001:db8::1"));
    const consume = createIpRateLimiter({ toolLimit: 1, maxEntries: 1 });
    expect(consume("bad", "tool").allowed).toBe(true);
    expect(consume("different-bad", "tool").allowed).toBe(false);
    expect(consume("192.0.2.3", "tool").allowed).toBe(false);
  });
  it("does not trust forwarded headers outside Vercel", () => {
    vi.stubEnv("VERCEL", "0");
    expect(vercelClientIp(request("192.0.2.1"))).toBe("unknown");
    vi.stubEnv("VERCEL", "1");
    expect(vercelClientIp(request("192.0.2.1"))).toBe("192.0.2.1");
    expect(vercelClientIp(request("192.0.2.1, spoofed"))).toBe("unknown");
  });
  it("enforces /api/tool before fetching upstream and returns 429 + Retry-After", async () => {
    vi.stubEnv("VERCEL", "1");
    const upstream = fakeMcp(); vi.stubGlobal("fetch", upstream);
    for (let i = 0; i < 30; i++) expect((await toolPost(request("192.0.2.10"))).status).toBe(200);
    const calls = upstream.mock.calls.length;
    const denied = await toolPost(request("192.0.2.10"));
    expect(denied.status).toBe(429); expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    expect(upstream.mock.calls.length).toBe(calls);
    expect((await toolPost(request("192.0.2.11"))).status).toBe(200);
  });
  it("enforces /api/initialize before performing another handshake", async () => {
    vi.stubEnv("VERCEL", "1");
    const upstream = fakeMcp(); vi.stubGlobal("fetch", upstream);
    for (let i = 0; i < 6; i++) expect((await initializePost(request("192.0.2.12", "initialize"))).status).toBe(200);
    const calls = upstream.mock.calls.length;
    const denied = await initializePost(request("192.0.2.12", "initialize"));
    expect(denied.status).toBe(429); expect(denied.headers.has("retry-after")).toBe(true);
    expect(upstream.mock.calls.length).toBe(calls);
  });
});

describe("HTTP failures and public diagnostics", () => {
  it.each([400, 429, 500, 503])("HTTP %s with a valid result cannot report success; body trace retained", async status => {
    const client = new McpClient("https://example.test/mcp", async (_url, options) => {
      const m = JSON.parse(String(options.body));
      if (m.method === "initialize") return Response.json({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-11-25" } });
      if (!m.id) return new Response(null, { status: 202 });
      return Response.json({ jsonrpc: "2.0", id: m.id, result: { structuredContent: { diagnostic: "deliberate-demo-body" } } }, { status });
    });
    const out = await createToolHandler(client)({ name: "get_disclaimer", arguments: {} });
    expect(out.status).toBe(502);
    expect(out.json).toMatchObject({ ok: false, isError: true, data: null, errorMessage: `MCP server returned HTTP ${status}` });
    const trace = (out.json as any).trace;
    expect(trace.at(-1).request.params.name).toBe("get_disclaimer");
    expect(trace.at(-1).response.result.structuredContent.diagnostic).toBe("deliberate-demo-body");
  });
  it.each(["initialize", "notifications/initialized"])("rejects non-2xx %s and leaves no reusable session", async failedMethod => {
    const client = new McpClient("https://example.test/mcp", async (_url, options) => {
      const m = JSON.parse(String(options.body));
      if (m.method === failedMethod) return Response.json({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-11-25" } }, { status: 500 });
      return Response.json({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-11-25" } });
    });
    await expect(client.initialize([])).rejects.toThrow();
    expect(client.info).toBeNull();
  });
  it("removes raw network/parse exception details from summaries and trace.error", async () => {
    for (const fail of [async () => { throw new Error("SECRET-connection-details"); }, async () => new Response("SECRET-invalid-JSON")]) {
      const client = new McpClient("https://example.test/mcp", fail);
      const tool = await createToolHandler(client)({ name: "get_disclaimer", arguments: {} });
      const init = await createInitializeHandler(client)();
      expect(tool.status).toBe(502); expect(init.status).toBe(502);
      expect(JSON.stringify(tool)).not.toContain("SECRET"); expect(JSON.stringify(init)).not.toContain("SECRET");
    }
  });
  it("keeps JSON-RPC error response bodies but uses a safe summary", async () => {
    const client = new McpClient("https://example.test/mcp", async (_url, options) => {
      const m = JSON.parse(String(options.body));
      if (m.method === "initialize") return Response.json({ jsonrpc: "2.0", id: m.id, result: {} });
      if (!m.id) return new Response(null, { status: 202 });
      return Response.json({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "deliberately-visible-body" } });
    });
    const trace: TraceEntry[] = [];
    const out = await client.callTool("get_disclaimer", {}, trace);
    expect(out.errorMessage).toBe("JSON-RPC error -32603");
    expect(trace.at(-1)?.response?.error?.message).toBe("deliberately-visible-body");
  });
});
