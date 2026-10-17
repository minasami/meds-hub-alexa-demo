/** Vercel Function: POST /api/tool {name, arguments}. Only the 5 read-only tools are allowed (403 otherwise). */
import { handleTool, json, postOnly, rateLimit } from "./_shared.js";

const MAX_BODY = 16 * 1024;

export async function POST(request: Request): Promise<Response> {
  const limited = rateLimit(request, "tool");
  if (limited) return limited;
  let text: string;
  try { text = await request.text(); }
  catch { return json(400, { ok: false, error: "Unable to read request body" }); }
  if (new TextEncoder().encode(text).length > MAX_BODY) return json(413, { ok: false, error: "Body too large" });
  let body: unknown;
  try {
    body = JSON.parse(text || "{}");
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }
  const out = await handleTool(body);
  return json(out.status, out.json);
}

export const GET = postOnly;
