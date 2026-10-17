/** Vercel Function: POST /api/initialize forces a fresh MCP initialize so the trace shows protocol negotiation. */
import { handleInit, json, postOnly, rateLimit } from "./_shared.js";

export async function POST(request: Request): Promise<Response> {
  const limited = rateLimit(request, "initialize");
  if (limited) return limited;
  const out = await handleInit();
  return json(out.status, out.json);
}

export const GET = postOnly;
