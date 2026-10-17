import "./style.css";
import { callTool, initialize, type ToolResponse } from "./api.js";
import {
  parseIntent, resolveChoice, disambiguationReply, noMatchReply, priceReply, compareReply, refusalReply,
  HELP_REPLY, SWITCH_WARNING, displayName, priceText, type Medicine, type Reply, type CompareRow,
} from "./dialog.js";
import { speechRecognitionSupported, speechSynthesisSupported, listenOnce, speak, stopSpeaking } from "./speech.js";

// ------------------------------------------------------------------ state
interface State {
  phase: "idle" | "choosing" | "selected";
  query: string;
  options: Medicine[];
  selected: Medicine | null;
  busy: boolean;
  speakReplies: boolean;
}
const state: State = { phase: "idle", query: "", options: [], selected: null, busy: false, speakReplies: false };

// ------------------------------------------------------------------ DOM helpers
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string | null)[]) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else n.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) n.append(typeof k === "string" ? document.createTextNode(k) : k);
  return n;
}
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const chat = $<HTMLDivElement>("#chat");
const form = $<HTMLFormElement>("#composer");
const input = $<HTMLInputElement>("#input");
const micBtn = $<HTMLButtonElement>("#mic");
const speakToggle = $<HTMLInputElement>("#speak");
const traceList = $<HTMLOListElement>("#trace-list");
const traceMeta = $<HTMLDivElement>("#trace-meta");
const ring = $<HTMLDivElement>("#ring");
const chips = $<HTMLDivElement>("#chips");

function scroll() {
  chat.scrollTop = chat.scrollHeight;
}

function userBubble(text: string) {
  chat.append(el("div", { class: "msg user" }, el("div", { class: "bubble" }, text)));
  scroll();
}

function assistantBubble(reply: Reply, extra?: Node | null, tone: "normal" | "warn" | "error" = "normal") {
  const body = el("div", { class: "bubble" });
  for (const line of reply.text.split("\n")) body.append(el("p", {}, line));
  if (extra) body.append(extra);
  chat.append(el("div", { class: `msg assistant ${tone}` }, el("div", { class: "avatar", "aria-hidden": "true" }), body));
  scroll();
  if (state.speakReplies && reply.spoken) speak(reply.spoken);
}

function setChips(list: { label: string; say: string }[]) {
  chips.replaceChildren(
    ...list.map((c) => {
      const b = el("button", { type: "button", class: "chip" }, c.label);
      b.addEventListener("click", () => submit(c.say));
      return b;
    }),
  );
}

function setBusy(b: boolean) {
  state.busy = b;
  ring.classList.toggle("thinking", b);
  input.disabled = b;
}

// ------------------------------------------------------------------ trace panel
let traceCount = 0;
function recordTrace(r: ToolResponse) {
  if (r.negotiatedProtocolVersion || r.serverInfo) {
    traceMeta.textContent =
      `Endpoint https://mcp.medicinesupport.app/mcp · client requested protocol ${r.requestedProtocolVersion ?? "?"} · ` +
      `server negotiated ${r.negotiatedProtocolVersion ?? "?"} · ${r.serverInfo?.name ?? "server"} v${r.serverInfo?.version ?? "?"}`;
  }
  for (const t of r.trace || []) {
    traceCount++;
    const status = t.error ? `error: ${t.error}` : `HTTP ${t.httpStatus}`;
    const summary = el(
      "summary",
      {},
      el("span", { class: "t-n" }, `#${traceCount}`),
      el("code", { class: "t-method" }, t.tool ? `tools/call → ${t.tool}` : t.method),
      el("span", { class: `t-status ${t.error || (t.httpStatus ?? 500) >= 400 || t.response?.result?.isError ? "bad" : "good"}` }, status),
      el("span", { class: "t-ms" }, `${t.durationMs} ms`),
    );
    const pre = (label: string, obj: unknown) =>
      el("div", { class: "t-block" }, el("div", { class: "t-label" }, label), el("pre", {}, JSON.stringify(obj, null, 2)));
    const details = el(
      "details",
      { class: "t-entry" },
      summary,
      el("div", { class: "t-sub" }, `${t.at} · ${t.contentType ?? "no body"}`),
      pre("JSON-RPC request", t.request),
      t.response ? pre("JSON-RPC response", t.response) : el("div", { class: "t-label" }, t.method.startsWith("notifications/") ? "Notification: no JSON-RPC response expected" : "No JSON-RPC response"),
    );
    traceList.append(el("li", {}, details));
  }
  traceList.parentElement!.scrollTop = traceList.parentElement!.scrollHeight;
}

async function tool(name: string, args: Record<string, unknown>) {
  const r = await callTool(name, args);
  recordTrace(r);
  return r;
}

function toolError(r: ToolResponse) {
  assistantBubble(
    {
      text: `I couldn't get an answer from the MedS Hub catalog (${r.tool}): ${r.errorMessage || "unknown error"}. I won't guess. Please try again.`,
      spoken: "I couldn't reach the catalog just now, so I won't guess. Please try again.",
    },
    null,
    "error",
  );
}

// ------------------------------------------------------------------ result widgets
function sourceLink(url: string | null) {
  if (!url || !/^https:\/\/medicinesupport\.app\//.test(url)) return null;
  return el("p", { class: "source" }, "Source: ", el("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, url));
}

function disclaimerNote(text: string | undefined) {
  return text ? el("p", { class: "tool-disclaimer" }, `Tool disclaimer: ${text}`) : null;
}

function optionList(options: Medicine[]) {
  const list = el("ol", { class: "options" });
  options.forEach((m, i) => {
    const b = el(
      "button",
      { type: "button", class: "option" },
      el("strong", {}, displayName(m)),
      el("span", {}, [m.strength, m.manufacturer, `catalog #${m.canonical_id}`].filter(Boolean).join(" · ")),
    );
    b.addEventListener("click", () => submit(`number ${i + 1}`));
    list.append(el("li", {}, b));
  });
  return list;
}

function compareTable(rows: CompareRow[]) {
  const head = el("tr", {}, ...["Product", "Strength", "Notes", "Catalog price"].map((h) => el("th", {}, h)));
  const body = rows.map((r) => {
    const flags = [r.isSelected ? "your pick" : null, r.differentStrength ? "different strength" : null, r.differentForm ? "different form" : null]
      .filter(Boolean)
      .join(", ");
    const name = r.item.url && /^https:\/\/medicinesupport\.app\//.test(r.item.url)
      ? el("a", { href: r.item.url, target: "_blank", rel: "noopener noreferrer" }, displayName(r.item))
      : displayName(r.item);
    return el(
      "tr",
      { class: r.isSelected ? "sel" : r.differentStrength || r.differentForm ? "diff" : "" },
      el("td", {}, name),
      el("td", {}, r.item.strength || "not recorded"),
      el("td", {}, flags || "same strength & form"),
      el("td", { class: r.priceMissing ? "missing" : "" }, priceText(r.item.current_price_egp)),
    );
  });
  return el("div", { class: "table-wrap" }, el("table", {}, el("thead", {}, head), el("tbody", {}, ...body)));
}

/** On screen the options render as numbered buttons, so show only the lead and hint as text. */
function choicePrompt(r: ReturnType<typeof disambiguationReply>): Reply {
  return { text: `${r.lead}\n${r.hint}`, spoken: r.spoken };
}

// ------------------------------------------------------------------ flow
async function lookup(query: string) {
  state.query = query;
  const r = await tool("search_medicines", { query, limit: 10 });
  if (!r.ok) return toolError(r);
  const items: Medicine[] = Array.isArray(r.data?.items) ? r.data.items : [];
  if (!items.length) {
    state.phase = "idle";
    assistantBubble(noMatchReply(query));
    setChips([{ label: "Try Controloc", say: "Alexa, look up Controloc" }]);
    return;
  }
  if (items.length === 1) {
    assistantBubble({ text: `I found one catalog entry for "${query}".`, spoken: "I found one catalog entry." });
    return select(items[0]);
  }
  state.phase = "choosing";
  state.options = items;
  assistantBubble(choicePrompt(disambiguationReply(query, items)), optionList(items));
  setChips([{ label: "Start over", say: "start over" }]);
}

async function select(item: Medicine) {
  state.selected = item;
  state.phase = "selected";
  state.options = [];
  const [detail, cost] = await Promise.all([
    tool("get_medicine", { id: String(item.canonical_id) }),
    tool("estimate_cost", { lines: [{ canonical_id: item.canonical_id, quantity: 1 }], locale: "en" }),
  ]);
  // get_medicine may fall back to a fuzzy match for unknown ids; only trust it when the id matches.
  if (detail.ok && Number(detail.data?.item?.canonical_id) === Number(item.canonical_id)) {
    state.selected = { ...item, ...detail.data.item };
  }
  if (!cost.ok) return toolError(cost);
  const p = priceReply(state.selected!, cost.data);
  const extra = el("div", {}, sourceLink(p.sourceUrl), disclaimerNote(cost.data?.disclaimer_en));
  assistantBubble(p, extra, p.priceEgp == null ? "warn" : "normal");
  setChips([
    { label: "Same active ingredient?", say: "Are there other products with the same active ingredient?" },
    { label: "Start over", say: "start over" },
  ]);
}

async function compare() {
  if (!state.selected) {
    assistantBubble({ text: "First tell me which medicine to look up, for example \"look up Controloc\".", spoken: "First tell me which medicine to look up." });
    return;
  }
  const r = await tool("compare_inn_prices", { canonical_id: state.selected.canonical_id, limit: 10 });
  if (!r.ok) return toolError(r);
  const c = compareReply(state.selected, r.data);
  const extra = el(
    "div",
    {},
    c.rows.length ? compareTable(c.rows) : null,
    el("p", { class: "warning" }, `⚠ ${SWITCH_WARNING}`),
    disclaimerNote(r.data?.disclaimer_en),
  );
  assistantBubble(c, extra, "normal");
  setChips([{ label: "Look up another medicine", say: "start over" }]);
}

async function handle(text: string) {
  const intent = parseIntent(text, { awaitingChoice: state.phase === "choosing", hasSelection: !!state.selected });
  switch (intent.type) {
    case "empty":
      return assistantBubble({ text: "Sorry, I didn't catch a medicine name.", spoken: "Sorry, I didn't catch a medicine name." });
    case "reset":
      Object.assign(state, { phase: "idle", query: "", options: [], selected: null });
      setChips(defaultChips);
      return assistantBubble({ text: "OK, starting over. Which medicine should I look up?", spoken: "OK. Which medicine should I look up?" });
    case "help":
      return assistantBubble(HELP_REPLY);
    case "refuse":
      return assistantBubble(refusalReply(intent.reason), null, "warn");
    case "compare":
      return compare();
    case "price":
      return state.selected ? select(state.selected) : undefined;
    case "choose": {
      const res = resolveChoice(intent.text, state.options);
      if (res.kind === "selected") return select(res.item);
      if (res.kind === "ambiguous") {
        state.options = res.candidates;
        return assistantBubble(choicePrompt(disambiguationReply(state.query, res.candidates, true)), optionList(res.candidates));
      }
      return assistantBubble(
        { text: `I didn't catch which one. Please pick 1 to ${state.options.length}, or say a strength or form.`, spoken: "Sorry, which one? Say a number, a strength, or a form." },
        optionList(state.options),
      );
    }
    case "lookup":
      return lookup(intent.query);
  }
}

async function submit(text: string) {
  const t = text.trim();
  if (!t || state.busy) return;
  stopSpeaking();
  userBubble(t);
  input.value = "";
  setBusy(true);
  try {
    await handle(t);
  } catch (err: any) {
    assistantBubble({ text: `Something went wrong in the demo: ${err?.message || err}`, spoken: "Something went wrong in the demo." }, null, "error");
  } finally {
    setBusy(false);
    input.focus();
  }
}

// ------------------------------------------------------------------ wiring
const defaultChips = [
  { label: "Look up Controloc", say: "Alexa, look up Controloc" },
  { label: "What can you do?", say: "help" },
];
setChips(defaultChips);

form.addEventListener("submit", (e) => {
  e.preventDefault();
  submit(input.value);
});

if (speechSynthesisSupported()) {
  speakToggle.addEventListener("change", () => {
    state.speakReplies = speakToggle.checked;
    if (!speakToggle.checked) stopSpeaking();
  });
} else {
  speakToggle.disabled = true;
  speakToggle.parentElement!.title = "Speech output is not supported in this browser";
}

if (speechRecognitionSupported()) {
  let active: { stop: () => void } | null = null;
  micBtn.addEventListener("click", async () => {
    if (active) return active.stop();
    stopSpeaking();
    micBtn.classList.add("listening");
    ring.classList.add("listening");
    try {
      const l = listenOnce("en-US", (t) => (input.value = t));
      active = l;
      const text = await l.promise;
      if (text) submit(text);
    } catch (err: any) {
      assistantBubble({ text: `Voice input unavailable (${err?.message || err}). You can type instead.`, spoken: "" }, null, "warn");
    } finally {
      active = null;
      micBtn.classList.remove("listening");
      ring.classList.remove("listening");
    }
  });
} else {
  micBtn.disabled = true;
  micBtn.title = "Speech input is not supported in this browser. Type instead.";
}

assistantBubble({
  text: 'Hi! Ask me about a medicine in the MedS Hub Egyptian catalog, e.g. "Alexa, look up Controloc". Information only, not medical advice.',
  spoken: "",
});

// Show the MCP handshake (requested vs negotiated protocol version) in the trace on load.
initialize().then((r) => {
  recordTrace(r);
  if (!r.ok) traceMeta.textContent = `MCP initialize failed: ${r.errorMessage}. Lookups will report errors instead of guessing.`;
});
