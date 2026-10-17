import { describe, it, expect } from "vitest";
import { POST as toolPost, GET as toolGet } from "../api/tool.js";
import { GET as initGet } from "../api/initialize.js";

const req = (body: string) =>
  new Request("https://demo.example/api/tool", { method: "POST", headers: { "content-type": "application/json" }, body });

describe("Vercel Function /api/tool", () => {
  it("refuses tools outside the read-only allowlist with 403", async () => {
    for (const name of ["submit_support_request", "add_watchlist_item", "whoami", "list_my_requests"]) {
      const res = await toolPost(req(JSON.stringify({ name, arguments: {} })));
      expect(res.status).toBe(403);
      expect((await res.json()).ok).toBe(false);
    }
  });
  it("rejects invalid JSON with 400", async () => {
    const res = await toolPost(req("{not json"));
    expect(res.status).toBe(400);
  });
  it("rejects invalid arguments with 400 before calling the MCP server", async () => {
    const res = await toolPost(req(JSON.stringify({ name: "search_medicines", arguments: { query: "" } })));
    expect(res.status).toBe(400);
  });
  it("rejects oversized bodies with 413", async () => {
    const res = await toolPost(req(JSON.stringify({ name: "search_medicines", arguments: { query: "x".repeat(20000) } })));
    expect(res.status).toBe(413);
  });
  it("is POST only", async () => {
    expect(toolGet().status).toBe(405);
    expect(initGet().status).toBe(405);
    expect(toolGet().headers.get("cache-control")).toBe("no-store");
  });
});
