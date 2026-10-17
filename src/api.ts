import type { TraceEntry } from "../server/mcpClient.js";

export interface ToolResponse {
  ok: boolean;
  tool: string;
  data: any;
  isError: boolean;
  errorMessage?: string;
  requestedProtocolVersion?: string;
  negotiatedProtocolVersion?: string | null;
  serverInfo?: { name?: string; version?: string } | null;
  trace: TraceEntry[];
  error?: string;
}

/** Call a read-only MCP tool through the local server-side proxy (/api/tool). */
export async function initialize(): Promise<ToolResponse> {
  return post("/api/initialize", {}, "initialize");
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResponse> {
  return post("/api/tool", { name, arguments: args }, name);
}

async function post(path: string, payload: unknown, name: string): Promise<ToolResponse> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => null);
    if (!json) return { ok: false, tool: name, data: null, isError: true, errorMessage: `Demo server returned HTTP ${res.status}`, trace: [] };
    return { trace: [], ...json, ok: !!json.ok && res.ok, errorMessage: json.errorMessage || json.error };
  } catch (err: any) {
    return { ok: false, tool: name, data: null, isError: true, errorMessage: `Demo server unreachable: ${err?.message || err}`, trace: [] };
  }
}
