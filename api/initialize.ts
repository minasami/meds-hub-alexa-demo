/** Vercel Function: POST /api/initialize forces a fresh MCP initialize so the trace shows protocol negotiation. */
import { handleInit, json, postOnly } from "./_shared.js";

export async function POST(): Promise<Response> {
  const out = await handleInit();
  return json(out.status, out.json);
}

export const GET = postOnly;
