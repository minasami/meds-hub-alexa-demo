# MedS Hub: simulated Alexa+ web experience

> **Simulated Alexa+ experience, not an Amazon product.** This is a web page that copies an Alexa+-style
> conversational flow. It is not built on, certified by, or endorsed by Amazon, and it does not run on an Echo
> device or the Alexa+ runtime. "Alexa" is a trademark of Amazon.

A small web demo for the Medicine Support Hub (MedS Hub) entry in the Amazon Alexa+ hackathon. A user asks
for an Egyptian medicine by voice (optional, browser Web Speech API) or by typing. The app:

1. calls `search_medicines` on the live MedS Hub MCP server and, when several catalog entries match
   (for example **Controloc**: four entries), asks the user which one they mean;
2. calls `get_medicine` and `estimate_cost` and gives the **indicative EGP catalog price** with a source link
   to `medicinesupport.app/catalog/<id>` and the tool's own disclaimer, or says plainly that no price is recorded;
3. on request calls `compare_inn_prices` and lists other catalog products with the same scientific name (INN),
   flagging entries whose **strength or dosage form differs**, with a warning that same INN does not mean
   interchangeable.

Every factual answer comes from a real MCP tool call. The **Tool trace** panel shows each JSON-RPC request and
response (including the `initialize` handshake and the protocol version the server negotiated).

**Information only.** No prescriptions, no dosing or switching advice, no sign-in, no writes. The demo
refuses clinical questions, national-ID/policy/card numbers, and write requests (watchlist, orders, etc.).

## Setup

Requirements: Node.js 20+ and npm. No API keys, accounts or secrets are needed (the tools used are public).

```bash
npm install && npm run dev     # http://localhost:5173
npm run build                  # type-check (client + server) and build to dist/ and dist-server/
npm start                      # serve the built app + API on http://localhost:4173 (PORT to override)
npm test                       # unit tests (offline)
npm run test:live              # optional: one read-only call to the live MCP server
```

Optional environment variable: `MCP_URL` (defaults to `https://mcp.medicinesupport.app/mcp`).

Voice: speech input uses `SpeechRecognition` / `webkitSpeechRecognition` (Chrome and Edge; needs microphone
permission and, in Chrome, a network connection to the browser vendor's speech service). Speech output uses
`speechSynthesis`. Both are English (`en-US`) only. Arabic medicine names can be typed. If speech is not
supported the mic button is disabled and typing works as usual.

## Architecture

```
Browser (Vite + TypeScript, no framework)
  src/main.ts      UI, conversation state machine, tool trace panel
  src/dialog.ts    pure logic: intent parsing, disambiguation, reply wording (unit tested)
  src/speech.ts    optional Web Speech API input/output
        │  POST /api/tool {name, arguments}     POST /api/initialize
        ▼
Server-side proxy (Node; Vite dev/preview middleware, or server/prod.ts for `npm start`)
  server/tools.ts      read-only allowlist + argument validation
  server/api.ts        HTTP handler, returns {data, trace, negotiatedProtocolVersion}
  server/mcpClient.ts  minimal MCP Streamable HTTP client (JSON + SSE parsing,
                       initialize → notifications/initialized → tools/call, Mcp-Session-Id,
                       MCP-Protocol-Version header, one retry on HTTP 404 session loss)
        │  JSON-RPC 2.0 over HTTPS (Streamable HTTP)
        ▼
MedS Hub MCP server (pre-existing)  https://mcp.medicinesupport.app/mcp
        ▼
MedS Hub catalog on Appwrite Cloud (pre-existing)
```

Why a server-side proxy: it keeps the tool allowlist on the server (the browser cannot call
`submit_prescription_request`, `submit_support_request`, watchlist or any other account tool through it), and it
avoids depending on browser CORS behaviour.

Allowed tools: `search_medicines`, `get_medicine`, `estimate_cost`, `compare_inn_prices`, `get_disclaimer`.
Everything else is rejected with HTTP 403 before any request leaves the proxy.

Protocol version: the client asks for `2025-11-25` in `initialize` and then uses whatever version the server
negotiates. On 17 Oct 2026 the live server (v0.3.3) answered `2025-03-26`; the trace panel shows the live value.
Do not claim 2025-11-25 compliance for the server until the server is upgraded and re-checked.

Honesty rules built into the flow:
- A price is shown only when `estimate_cost` returns a positive `unit_egp` for the **same** catalog id the user
  picked; otherwise the reply says the catalog has no recorded price (or that the tool returned a different record).
- `get_medicine` details are merged only when the returned `canonical_id` matches the picked one (the server can
  fall back to a fuzzy match for unknown ids).
- Same-INN results are shown with per-row "different strength" / "different form" flags (form inferred from the
  record name, because `dosage_form` is often empty) and a fixed warning.
- Network, HTTP, JSON-RPC and tool errors are shown as errors; nothing is guessed.
- Catalog text is rendered with `textContent` (no HTML injection from catalog data); source links are only
  rendered for `https://medicinesupport.app/` URLs.

## Pre-existing assets vs. built during the hackathon window

| Pre-existing (before this demo) | Built during the hackathon window (this repository) |
|---|---|
| MedS Hub MCP server at `https://mcp.medicinesupport.app/mcp` (tools, OAuth account tools, disclaimers) | The simulated Alexa+ web UI (chat/voice-style interface, labels, disclaimer) |
| MedS Hub Egyptian medicine catalog (Appwrite Cloud) and web app `medicinesupport.app` | Server-side read-only MCP proxy and minimal Streamable HTTP client |
| | Conversation logic: intent parsing, multi-entry disambiguation, missing-price and same-INN wording |
| | Tool trace panel, Web Speech API input/output, tests |

Check the git log of this repository for the exact dates of this work.

## Tests

`npm test` runs offline unit tests (Vitest) for: SSE/JSON response parsing, tool-result interpretation,
the MCP handshake and session handling (with a fake `fetch`), the read-only allowlist and argument validation,
intent parsing and refusals, Controloc disambiguation (by number, ordinal, strength, form, and "new"),
missing-price handling, and same-INN strength/form flags. `npm run test:live` makes one read-only
`search_medicines` call to the live server.

## Screenshots

`screenshots/` holds headless-Chrome captures of the flow taken on 17 Oct 2026 against the live server.
Prices in them are catalog values at that moment and will change.

## License

MIT, see [LICENSE](LICENSE). The license covers this demo's code only, not the MedS Hub catalog data.
