// Optional live check against the public MCP server. Run with: npm run test:live
import { describe, it, expect } from "vitest";
import { McpClient, type TraceEntry } from "../server/mcpClient";

describe.skipIf(!process.env.LIVE_MCP)("live MCP server (read-only)", () => {
  it("search_medicines Controloc returns several entries and negotiates a protocol version", async () => {
    const client = new McpClient();
    const trace: TraceEntry[] = [];
    const out = await client.callTool("search_medicines", { query: "Controloc", limit: 10 }, trace);
    expect(out.ok).toBe(true);
    expect(out.data.count).toBeGreaterThan(1);
    console.log("negotiated protocol:", client.info?.protocolVersion, "server:", client.info?.serverInfo);
  }, 30000);
});
