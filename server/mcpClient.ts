/**
 * Minimal MCP client for the Streamable HTTP transport (JSON-RPC 2.0 over POST,
 * responses as application/json or text/event-stream).
 *
 * Read-only use only: callers are expected to pass tool names through the
 * allowlist in ./tools.ts before calling callTool().
 */

export const DEFAULT_MCP_URL = "https://mcp.medicinesupport.app/mcp";
/** Version we ask for. The server answers with the version it actually supports. */
export const REQUESTED_PROTOCOL_VERSION = "2025-11-25";
const CLIENT_INFO = { name: "meds-hub-simulated-alexa-demo", version: "0.1.0" };

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

export interface TraceEntry {
  at: string;
  method: string;
  tool?: string;
  url: string;
  httpStatus: number | null;
  durationMs: number;
  request: JsonRpcMessage;
  response: JsonRpcMessage | null;
  /** Response content type as returned by the server (json or event-stream). */
  contentType: string | null;
  error?: string;
}

export interface ToolCallOutcome {
  ok: boolean;
  /** Parsed tool payload (structuredContent, or JSON parsed from the first text block). */
  data: any;
  /** True when the tool itself reported isError, or when a JSON-RPC/HTTP error happened. */
  isError: boolean;
  errorMessage?: string;
}

/**
 * Parse a Streamable HTTP response body into JSON-RPC messages.
 * Handles both a plain JSON body (single message or batch) and an SSE stream.
 */
export function parseMcpResponseBody(body: string, contentType: string | null): JsonRpcMessage[] {
  const ct = (contentType || "").toLowerCase();
  const trimmed = body.trim();
  if (!trimmed) return [];
  if (ct.includes("text/event-stream") || /^(event|data|id|retry):/m.test(trimmed.split("\n")[0] || "")) {
    return parseSse(body);
  }
  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [parsed];
}

/** Parse an SSE stream; each event's data lines are joined with "\n" and parsed as JSON. */
export function parseSse(body: string): JsonRpcMessage[] {
  const out: JsonRpcMessage[] = [];
  const events = body.replace(/\r\n/g, "\n").split(/\n\n+/);
  for (const ev of events) {
    const dataLines: string[] = [];
    for (const line of ev.split("\n")) {
      if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (!dataLines.length) continue;
    const data = dataLines.join("\n").trim();
    if (!data) continue;
    try {
      const msg = JSON.parse(data);
      if (Array.isArray(msg)) out.push(...msg);
      else out.push(msg);
    } catch {
      // Ignore non-JSON keep-alive or comment payloads.
    }
  }
  return out;
}

/** Turn a tools/call JSON-RPC response into a simple outcome. */
export function interpretToolResult(msg: JsonRpcMessage | null | undefined): ToolCallOutcome {
  if (!msg) return { ok: false, data: null, isError: true, errorMessage: "No response from MCP server" };
  if (msg.error) {
    return { ok: false, data: null, isError: true, errorMessage: `JSON-RPC error ${msg.error.code}: ${msg.error.message}` };
  }
  const result = msg.result;
  if (!result || typeof result !== "object") {
    return { ok: false, data: null, isError: true, errorMessage: "Malformed tool result" };
  }
  let data: any = result.structuredContent ?? null;
  if (data == null && Array.isArray(result.content)) {
    const text = result.content.find((c: any) => c && c.type === "text" && typeof c.text === "string");
    if (text) {
      try {
        data = JSON.parse(text.text);
      } catch {
        data = { text: text.text };
      }
    }
  }
  if (result.isError) {
    const message = (data && (data.error || data.message || data.text)) || "Tool reported an error";
    return { ok: false, data, isError: true, errorMessage: String(message) };
  }
  return { ok: true, data, isError: false };
}

export interface McpSessionInfo {
  protocolVersion: string | null;
  serverInfo: { name?: string; version?: string } | null;
  sessionId: string | null;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class McpClient {
  private nextId = 1;
  private session: McpSessionInfo | null = null;
  private sessionStartedAt = 0;
  private initPromise: Promise<McpSessionInfo> | null = null;

  constructor(
    private readonly url: string = DEFAULT_MCP_URL,
    private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i),
    private readonly timeoutMs = 15000,
    private readonly sessionTtlMs = 5 * 60 * 1000,
  ) {}

  get info(): McpSessionInfo | null {
    return this.session;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (this.session?.protocolVersion) h["mcp-protocol-version"] = this.session.protocolVersion;
    if (this.session?.sessionId) h["mcp-session-id"] = this.session.sessionId;
    return h;
  }

  private async post(message: JsonRpcMessage, trace: TraceEntry[], tool?: string) {
    const started = Date.now();
    const entry: TraceEntry = {
      at: new Date(started).toISOString(),
      method: message.method || "?",
      tool,
      url: this.url,
      httpStatus: null,
      durationMs: 0,
      request: message,
      response: null,
      contentType: null,
    };
    trace.push(entry);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(message),
        signal: ctrl.signal,
      });
      entry.httpStatus = res.status;
      entry.contentType = res.headers.get("content-type");
      const body = await res.text();
      const messages = message.id === undefined ? [] : parseMcpResponseBody(body, entry.contentType);
      const match = messages.find((m) => m.id === message.id) || null;
      entry.response = match;
      if (!res.ok && !match) entry.error = `HTTP ${res.status}`;
      return { res, match };
    } catch (err: any) {
      entry.error = err?.name === "AbortError" ? `Timed out after ${this.timeoutMs} ms` : String(err?.message || err);
      throw new Error(entry.error);
    } finally {
      clearTimeout(timer);
      entry.durationMs = Date.now() - started;
    }
  }

  /** Start a fresh session. Concurrent tool calls wait for an in-flight initialize instead of starting another. */
  initialize(trace: TraceEntry[]): Promise<McpSessionInfo> {
    const p = this.doInitialize(trace).finally(() => {
      if (this.initPromise === p) this.initPromise = null;
    });
    this.initPromise = p;
    return p;
  }

  private async doInitialize(trace: TraceEntry[]): Promise<McpSessionInfo> {
    this.session = null;
    const id = this.nextId++;
    const { res, match } = await this.post(
      {
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: { protocolVersion: REQUESTED_PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
      },
      trace,
    );
    if (!match || match.error || !match.result) {
      throw new Error(match?.error ? `initialize failed: ${match.error.message}` : `initialize failed (HTTP ${res.status})`);
    }
    this.session = {
      protocolVersion: match.result.protocolVersion ?? null,
      serverInfo: match.result.serverInfo ?? null,
      sessionId: res.headers.get("mcp-session-id"),
    };
    this.sessionStartedAt = Date.now();
    // Required follow-up notification (no id, no response expected; server answers 202).
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, trace);
    return this.session;
  }

  private sessionExpired() {
    return !this.session || Date.now() - this.sessionStartedAt > this.sessionTtlMs;
  }

  async callTool(name: string, args: Record<string, unknown>, trace: TraceEntry[]): Promise<ToolCallOutcome> {
    if (this.initPromise) await this.initPromise;
    else if (this.sessionExpired()) await this.initialize(trace);
    const send = () =>
      this.post({ jsonrpc: "2.0", id: this.nextId++, method: "tools/call", params: { name, arguments: args } }, trace, name);
    let { res, match } = await send();
    // Session gone (server restarted / instance changed): re-initialize once and retry.
    if (res.status === 404 && this.session?.sessionId) {
      await this.initialize(trace);
      ({ res, match } = await send());
    }
    if (!match) {
      return { ok: false, data: null, isError: true, errorMessage: `MCP server returned HTTP ${res.status} with no matching JSON-RPC response` };
    }
    return interpretToolResult(match);
  }
}
