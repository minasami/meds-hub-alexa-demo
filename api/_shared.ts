/** Shared helpers for the Vercel Functions in api/. Files prefixed with _ are not routed. */
import { McpClient, DEFAULT_MCP_URL } from "../server/mcpClient.js";
import { createToolHandler, createInitializeHandler } from "../server/api.js";

// Module scope survives warm invocations, so the MCP session is reused when possible.
const client = new McpClient(process.env.MCP_URL || DEFAULT_MCP_URL);
export const handleTool = createToolHandler(client);
export const handleInit = createInitializeHandler(client);

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export const postOnly = () => json(405, { ok: false, error: "POST only" });
