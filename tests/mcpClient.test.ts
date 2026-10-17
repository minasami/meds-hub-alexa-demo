import { describe, it, expect } from "vitest";
import { parseSse, parseMcpResponseBody, interpretToolResult, McpClient, REQUESTED_PROTOCOL_VERSION, type TraceEntry } from "../server/mcpClient";

const sse = (obj: unknown) => `event: message\ndata: ${JSON.stringify(obj)}\n\n`;

describe("Streamable HTTP response parsing", () => {
  it("parses an SSE body", () => {
    const msgs = parseSse(sse({ jsonrpc: "2.0", id: 1, result: { ok: 1 } }) + ": keep-alive\n\n");
    expect(msgs).toEqual([{ jsonrpc: "2.0", id: 1, result: { ok: 1 } }]);
  });
  it("joins multi-line data fields and handles CRLF", () => {
    const body = 'event: message\r\ndata: {"jsonrpc":"2.0",\r\ndata: "id":2,"result":{}}\r\n\r\n';
    expect(parseSse(body)).toEqual([{ jsonrpc: "2.0", id: 2, result: {} }]);
  });
  it("parses plain JSON and batches", () => {
    expect(parseMcpResponseBody('{"jsonrpc":"2.0","id":3,"result":{}}', "application/json")).toHaveLength(1);
    expect(parseMcpResponseBody('[{"jsonrpc":"2.0","id":3,"result":{}},{"jsonrpc":"2.0","id":4,"result":{}}]', "application/json")).toHaveLength(2);
    expect(parseMcpResponseBody("", "application/json")).toEqual([]);
  });
});

describe("tool result interpretation", () => {
  it("prefers structuredContent", () => {
    const r = interpretToolResult({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "{}" }], structuredContent: { count: 4 } } });
    expect(r).toEqual({ ok: true, data: { count: 4 }, isError: false });
  });
  it("falls back to JSON in the text block", () => {
    const r = interpretToolResult({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: '{"count":2}' }] } });
    expect(r.data).toEqual({ count: 2 });
  });
  it("reports isError and JSON-RPC errors", () => {
    expect(interpretToolResult({ jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text", text: "boom" }] } })).toMatchObject({ ok: false, isError: true, errorMessage: "MCP tool reported an error" });
    expect(interpretToolResult({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad params" } })).toMatchObject({ ok: false, errorMessage: "JSON-RPC error -32602" });
    expect(interpretToolResult(null).ok).toBe(false);
  });
});

describe("McpClient handshake", () => {
  it("initializes, sends notifications/initialized, reuses session headers and records the negotiated version", async () => {
    const calls: { body: any; headers: Record<string, string> }[] = [];
    const fakeFetch = async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ body, headers: init.headers as Record<string, string> });
      if (body.method === "initialize") {
        return new Response(sse({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26", serverInfo: { name: "x", version: "1" }, capabilities: {} } }), {
          headers: { "content-type": "text/event-stream", "mcp-session-id": "sess-1" },
        });
      }
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { echo: body.params } } }), {
        headers: { "content-type": "application/json" },
      });
    };
    const client = new McpClient("https://example.test/mcp", fakeFetch);
    const trace: TraceEntry[] = [];
    const out = await client.callTool("search_medicines", { query: "Controloc" }, trace);
    expect(out.ok).toBe(true);
    expect(out.data.echo).toEqual({ name: "search_medicines", arguments: { query: "Controloc" } });
    expect(calls.map((c) => c.body.method)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
    expect(calls[0].body.params.protocolVersion).toBe(REQUESTED_PROTOCOL_VERSION);
    expect(calls[2].headers["mcp-session-id"]).toBe("sess-1");
    expect(calls[2].headers["mcp-protocol-version"]).toBe("2025-03-26");
    expect(client.info?.protocolVersion).toBe("2025-03-26");
    expect(trace.map((t) => t.method)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
    // second call reuses the session
    await client.callTool("get_disclaimer", {}, trace);
    expect(calls.filter((c) => c.body.method === "initialize")).toHaveLength(1);
  });

  it("re-initializes once when the session is gone (HTTP 404)", async () => {
    let inits = 0;
    let toolCalls = 0;
    const fakeFetch = async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.method === "initialize") {
        inits++;
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-11-25" } }), { headers: { "content-type": "application/json", "mcp-session-id": `s${inits}` } });
      }
      if (!body.id) return new Response(null, { status: 202 });
      toolCalls++;
      if (toolCalls === 1) return new Response("", { status: 404 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { ok: true } } }), { headers: { "content-type": "application/json" } });
    };
    const client = new McpClient("https://example.test/mcp", fakeFetch);
    const out = await client.callTool("get_disclaimer", {}, []);
    expect(out.ok).toBe(true);
    expect(inits).toBe(2);
  });

  it("does not start a second initialize while one is in flight", async () => {
    let inits = 0;
    const fakeFetch = async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.method === "initialize") {
        inits++;
        await new Promise((r) => setTimeout(r, 20));
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26" } }), { headers: { "content-type": "application/json" } });
      }
      if (!body.id) return new Response(null, { status: 202 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { structuredContent: {} } }), { headers: { "content-type": "application/json" } });
    };
    const client = new McpClient("https://example.test/mcp", fakeFetch);
    await Promise.all([client.initialize([]), client.callTool("get_disclaimer", {}, []), client.callTool("get_disclaimer", {}, [])]);
    expect(inits).toBe(1);
  });

  it("surfaces network failures in the trace", async () => {
    const client = new McpClient("https://example.test/mcp", async () => {
      throw new Error("ECONNREFUSED");
    });
    const trace: TraceEntry[] = [];
    await expect(client.callTool("get_disclaimer", {}, trace)).rejects.toThrow("MCP transport or response failure");
    expect(trace[0].error).toBe("MCP transport or response failure");
  });
});
