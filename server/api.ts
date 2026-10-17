import type { IncomingMessage, ServerResponse } from "node:http";
import { McpClient, DEFAULT_MCP_URL, REQUESTED_PROTOCOL_VERSION, type TraceEntry } from "./mcpClient.js";
import { isAllowedTool, validateArgs, ALLOWED_TOOLS } from "./tools.js";

export interface ToolApiResponse {
  ok: boolean;
  tool: string;
  data: any;
  isError: boolean;
  errorMessage?: string;
  requestedProtocolVersion: string;
  negotiatedProtocolVersion: string | null;
  serverInfo: { name?: string; version?: string } | null;
  trace: TraceEntry[];
}

export function createToolHandler(client = new McpClient(process.env.MCP_URL || DEFAULT_MCP_URL)) {
  return async function handleTool(body: any): Promise<{ status: number; json: ToolApiResponse | { ok: false; error: string } }> {
    const name = body?.name;
    if (!isAllowedTool(name)) {
      return { status: 403, json: { ok: false, error: `Tool not allowed in this read-only demo. Allowed: ${ALLOWED_TOOLS.join(", ")}` } };
    }
    const v = validateArgs(name, body?.arguments);
    if (!v.ok) return { status: 400, json: { ok: false, error: v.error } };
    const trace: TraceEntry[] = [];
    try {
      const outcome = await client.callTool(name, v.args, trace);
      return {
        status: 200,
        json: {
          ...outcome,
          tool: name,
          requestedProtocolVersion: REQUESTED_PROTOCOL_VERSION,
          negotiatedProtocolVersion: client.info?.protocolVersion ?? null,
          serverInfo: client.info?.serverInfo ?? null,
          trace,
        },
      };
    } catch (err: any) {
      return {
        status: 502,
        json: {
          ok: false,
          tool: name,
          data: null,
          isError: true,
          errorMessage: `Could not reach the MCP server: ${err?.message || err}`,
          requestedProtocolVersion: REQUESTED_PROTOCOL_VERSION,
          negotiatedProtocolVersion: client.info?.protocolVersion ?? null,
          serverInfo: client.info?.serverInfo ?? null,
          trace,
        },
      };
    }
  };
}

function readBody(req: IncomingMessage, max = 16 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Error("Body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Force a fresh initialize handshake so the trace shows protocol negotiation. */
export function createInitializeHandler(client: McpClient) {
  return async () => {
    const trace: TraceEntry[] = [];
    try {
      const info = await client.initialize(trace);
      return { status: 200, json: { ok: true, tool: "initialize", data: info && { protocolVersion: info.protocolVersion, serverInfo: info.serverInfo }, isError: false, requestedProtocolVersion: REQUESTED_PROTOCOL_VERSION, negotiatedProtocolVersion: info.protocolVersion, serverInfo: info.serverInfo, trace } };
    } catch (err: any) {
      return { status: 502, json: { ok: false, tool: "initialize", data: null, isError: true, errorMessage: String(err?.message || err), requestedProtocolVersion: REQUESTED_PROTOCOL_VERSION, negotiatedProtocolVersion: null, serverInfo: null, trace } };
    }
  };
}

/** Connect-style middleware: POST /api/tool {name, arguments}; POST /api/initialize. */
export function createApiMiddleware() {
  const client = new McpClient(process.env.MCP_URL || DEFAULT_MCP_URL);
  const handleTool = createToolHandler(client);
  const handleInit = createInitializeHandler(client);
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = (req.url || "").split("?")[0];
    if (url !== "/api/tool" && url !== "/api/initialize") return next();
    const send = (status: number, json: unknown) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify(json));
    };
    if (req.method !== "POST") return send(405, { ok: false, error: "POST only" });
    if (url === "/api/initialize") {
      const out = await handleInit();
      return send(out.status, out.json);
    }
    let body: any;
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      return send(400, { ok: false, error: "Invalid JSON body" });
    }
    const out = await handleTool(body);
    send(out.status, out.json);
  };
}
