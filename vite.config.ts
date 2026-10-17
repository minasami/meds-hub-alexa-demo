import { defineConfig, type Plugin } from "vite";
import { createApiMiddleware } from "./server/api.ts";

/** Mounts the server-side MCP proxy (/api/tool) on the Vite dev and preview servers. */
function mcpApi(): Plugin {
  return {
    name: "meds-hub-mcp-api",
    configureServer(server) {
      server.middlewares.use(createApiMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(createApiMiddleware());
    },
  };
}

export default defineConfig({
  plugins: [mcpApi()],
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
} as any);
