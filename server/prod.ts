/** Production server: serves the built SPA from dist/ and the /api/tool proxy. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiMiddleware } from "./api.js";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../dist");
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};
const api = createApiMiddleware();
const port = Number(process.env.PORT || 4173);

createServer((req, res) => {
  api(req, res, async () => {
    const path = normalize(decodeURIComponent((req.url || "/").split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    let file = join(root, path === "/" ? "index.html" : path);
    if (!file.startsWith(root)) file = join(root, "index.html");
    try {
      const buf = await readFile(file);
      res.setHeader("content-type", types[extname(file)] || "application/octet-stream");
      res.end(buf);
    } catch {
      const buf = await readFile(join(root, "index.html"));
      res.setHeader("content-type", types[".html"]);
      res.end(buf);
    }
  });
}).listen(port, () => console.log(`Simulated Alexa+ demo on http://localhost:${port}`));
