import { describe, it, expect } from "vitest";
import { isAllowedTool, validateArgs } from "../server/tools";
import { createToolHandler } from "../server/api";
import { McpClient } from "../server/mcpClient";

describe("read-only allowlist", () => {
  it("allows only catalog/cost/compare tools", () => {
    for (const t of ["search_medicines", "get_medicine", "estimate_cost", "compare_inn_prices", "get_disclaimer"]) expect(isAllowedTool(t)).toBe(true);
    for (const t of ["submit_prescription_request", "submit_support_request", "add_watchlist_item", "list_my_watchlist", "whoami", "submit_drug_contribution", "", undefined])
      expect(isAllowedTool(t)).toBe(false);
  });
  it("handler refuses blocked tools without calling the server", async () => {
    let called = false;
    const client = new McpClient("https://example.test/mcp", async () => {
      called = true;
      throw new Error("should not be called");
    });
    const out = await createToolHandler(client)({ name: "submit_prescription_request", arguments: {} });
    expect(out.status).toBe(403);
    expect(called).toBe(false);
  });
  it("validates arguments", () => {
    expect(validateArgs("search_medicines", { query: "  Controloc " })).toEqual({ ok: true, args: { query: "Controloc" } });
    expect(validateArgs("search_medicines", { query: "" }).ok).toBe(false);
    expect(validateArgs("search_medicines", { query: "x", limit: 99 }).ok).toBe(false);
    expect(validateArgs("estimate_cost", { lines: [{ canonical_id: 15008 }] })).toEqual({ ok: true, args: { lines: [{ canonical_id: 15008, quantity: 1 }], locale: "en" } });
    expect(validateArgs("estimate_cost", { lines: [] }).ok).toBe(false);
    expect(validateArgs("compare_inn_prices", {}).ok).toBe(false);
    expect(validateArgs("get_medicine", { id: "../etc" }).ok).toBe(false);
  });
});
