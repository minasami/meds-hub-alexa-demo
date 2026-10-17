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

// Per warm instance; not a distributed quota across regions/cold starts.
import { createIpRateLimiter, vercelClientIp, type ProxyRoute } from "../server/rateLimit.js";
const consume = createIpRateLimiter();
export function rateLimit(request: Request, route: ProxyRoute): Response | null {
  const result = consume(vercelClientIp(request), route);
  if (result.allowed) return null;
  const response = json(429, { ok: false, error: "Too many requests. Try again later." });
  response.headers.set("retry-after", String(result.retryAfter));
  return response;
}
