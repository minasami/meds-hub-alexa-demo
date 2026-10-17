/**
 * Read-only tool allowlist. The demo proxy refuses every other tool name,
 * including account, watchlist, support-request and prescription tools.
 */
export const ALLOWED_TOOLS = [
  "search_medicines",
  "get_medicine",
  "estimate_cost",
  "compare_inn_prices",
  "get_disclaimer",
] as const;
export type AllowedTool = (typeof ALLOWED_TOOLS)[number];

export function isAllowedTool(name: unknown): name is AllowedTool {
  return typeof name === "string" && (ALLOWED_TOOLS as readonly string[]).includes(name);
}

const str = (v: unknown, max = 120) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const id = (v: unknown) => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && /^[\w-]{1,40}$/.test(v));
const limit = (v: unknown) => v === undefined || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 20);

/** Validate and normalise arguments; returns an error string when invalid. */
export function validateArgs(
  name: AllowedTool,
  args: any,
): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  const a = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  switch (name) {
    case "search_medicines":
      if (!str(a.query)) return { ok: false, error: "query must be a non-empty string (max 120 chars)" };
      if (!limit(a.limit)) return { ok: false, error: "limit must be an integer 1-20" };
      return { ok: true, args: { query: a.query.trim(), ...(a.limit ? { limit: a.limit } : {}) } };
    case "get_medicine":
      if (!id(a.id)) return { ok: false, error: "id must be a catalog id" };
      return { ok: true, args: { id: String(a.id) } };
    case "estimate_cost": {
      if (!Array.isArray(a.lines) || a.lines.length < 1 || a.lines.length > 5) return { ok: false, error: "lines must have 1-5 entries" };
      const lines = [];
      for (const l of a.lines) {
        if (!l || !id(l.canonical_id)) return { ok: false, error: "each line needs a canonical_id" };
        const q = l.quantity === undefined ? 1 : l.quantity;
        if (!Number.isInteger(q) || q < 1 || q > 20) return { ok: false, error: "quantity must be an integer 1-20" };
        lines.push({ canonical_id: l.canonical_id, quantity: q });
      }
      return { ok: true, args: { lines, locale: a.locale === "ar" ? "ar" : "en" } };
    }
    case "compare_inn_prices":
      if (!id(a.canonical_id)) return { ok: false, error: "canonical_id is required" };
      if (!limit(a.limit)) return { ok: false, error: "limit must be an integer 1-20" };
      return { ok: true, args: { canonical_id: a.canonical_id, ...(a.limit ? { limit: a.limit } : {}) } };
    case "get_disclaimer":
      return { ok: true, args: {} };
  }
}
