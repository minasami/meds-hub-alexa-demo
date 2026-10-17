/**
 * Pure conversation logic for the simulated Alexa+ flow: intent parsing,
 * disambiguation between catalog entries, and reply wording.
 * No network or DOM access here so it can be unit tested.
 */

export interface Medicine {
  canonical_id: number;
  name_en: string;
  name_ar?: string;
  scientific_name?: string;
  manufacturer?: string;
  strength?: string;
  dosage_form?: string;
  current_price_egp?: number | null;
  url?: string;
}

export type Intent =
  | { type: "empty" }
  | { type: "reset" }
  | { type: "help" }
  | { type: "refuse"; reason: "clinical" | "sensitive_id" | "write" }
  | { type: "compare" }
  | { type: "price" }
  | { type: "choose"; text: string }
  | { type: "lookup"; query: string };

export interface DialogContext {
  awaitingChoice: boolean;
  hasSelection: boolean;
}

const WAKE = /^\s*(hey\s+|ok\s+)?alexa[\s,.:!]*/i;
const LOOKUP_PREFIX =
  /^\s*(please\s+|can you\s+|could you\s+)?(look\s*up|lookup|check( the price of| price of| on)?|search( for)?|find( me)?|tell me about|what('s| is) the price (of|for)|how much (is|does|are)( a| an| the)?|price (of|for)|show me|get me)\s+/i;
const TRAILING = /\s+(cost|costs|price|prices|please|for me)\s*$/i;

export function stripWakeWord(text: string): string {
  return text.replace(WAKE, "").trim();
}

/** Extract a medicine name from an utterance like "Alexa, look up Controloc please". */
export function extractMedicineQuery(text: string): string {
  let t = stripWakeWord(text).replace(/[?.!،؟]+$/g, "").trim();
  for (let i = 0; i < 3; i++) {
    const before = t;
    t = t.replace(LOOKUP_PREFIX, "").replace(TRAILING, "").trim();
    if (t === before) break;
  }
  return t.replace(/^["'“”]+|["'“”]+$/g, "").trim();
}

const CLINICAL =
  /\b(dos(e|es|ing)|how (much|many|often) should i|should i (take|switch|stop|change|use)|can i (take|switch|replace|swap|stop)|prescri(be|ption)|diagnos\w*|treat my|is it safe|side effects?|interact(ion|s)?)\b/i;
const SENSITIVE_ID = /\b\d{14}\b|\b(national id|policy number|card number|member id)\b/i;
const WRITE = /\b(add .* (to )?(my )?watchlist|watchlist|submit|upload|order|buy|reserve)\b/i;
const COMPARE =
  /(same (active )?(ingredient|inn|scientific name|molecule)|alternativ|generic|other (products|brands|options)|substitut|cheaper|بديل|بدائل|نفس المادة)/i;
const PRICE_ONLY = /^(what('s| is) the )?(price|cost)( again)?\??$|^how much( is it)?\??$/i;
const RESET = /^(start over|reset|new search|clear|cancel)\b/i;
const HELP = /^(help|what can you do)\b/i;

export function parseIntent(raw: string, ctx: DialogContext): Intent {
  const text = stripWakeWord(raw).trim();
  if (!text) return { type: "empty" };
  if (SENSITIVE_ID.test(text)) return { type: "refuse", reason: "sensitive_id" };
  if (RESET.test(text)) return { type: "reset" };
  if (HELP.test(text)) return { type: "help" };
  if (CLINICAL.test(text)) return { type: "refuse", reason: "clinical" };
  if (WRITE.test(text)) return { type: "refuse", reason: "write" };
  if (COMPARE.test(text)) return { type: "compare" };
  if (ctx.hasSelection && PRICE_ONLY.test(text)) return { type: "price" };
  if (ctx.awaitingChoice && !LOOKUP_PREFIX.test(text)) return { type: "choose", text };
  const query = extractMedicineQuery(text);
  return query ? { type: "lookup", query } : { type: "empty" };
}

// ---------------------------------------------------------------- forms

export type Form =
  | "injection"
  | "tablet"
  | "capsule"
  | "syrup"
  | "suspension"
  | "effervescent"
  | "sachet"
  | "drops"
  | "cream"
  | "suppository"
  | "spray";

const FORM_PATTERNS: [Form, RegExp][] = [
  ["injection", /\b(vial|amp(oule|ule)?s?|inj(ection)?|i\.?\s?v\.?|i\.?\s?m\.?|infusion|inf\.?)\b/i],
  ["effervescent", /\beff(ervescent|\.)?\b/i],
  ["sachet", /\bsachets?\b/i],
  ["capsule", /\bcaps?(ules?)?\.?\b/i],
  ["syrup", /\bsyr(up)?\.?\b/i],
  ["suspension", /\bsusp(ension)?\.?\b/i],
  ["drops", /\bdrops?\b/i],
  ["cream", /\b(cream|oint(ment)?|gel)\b/i],
  ["suppository", /\bsupp(ository|ositories|s)?\.?\b/i],
  ["spray", /\bspray\b/i],
  ["tablet", /\b(tabs?|tablets?|tab\.)\b/i],
];

/** Infer a dosage form from the record (dosage_form is often empty, so fall back to the name). */
export function inferForm(m: Pick<Medicine, "name_en" | "dosage_form">): Form | null {
  const hay = `${m.dosage_form || ""} ${m.name_en || ""}`;
  for (const [form, re] of FORM_PATTERNS) if (re.test(hay)) return form;
  return null;
}

/** Form mentioned by the user in a reply, if any. */
export function formInUtterance(text: string): Form | null {
  for (const [form, re] of FORM_PATTERNS) if (re.test(text)) return form;
  if (/\b(pills?|oral)\b/i.test(text)) return "tablet";
  return null;
}

// ------------------------------------------------------------- strength

export function normalizeStrength(s: string | undefined | null): string {
  return (s || "").toLowerCase().replace(/\s+/g, "").replace(/milligrams?/, "mg");
}

export function strengthsInUtterance(text: string): string[] {
  const out: string[] = [];
  const re = /(\d+(?:\.\d+)?)\s*(mg|milligrams?|mcg|micrograms?|g|grams?|ml|iu|%)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let unit = m[2].toLowerCase();
    if (unit.startsWith("milligram")) unit = "mg";
    else if (unit.startsWith("microgram")) unit = "mcg";
    else if (unit.startsWith("gram")) unit = "g";
    out.push(`${m[1]}${unit}`);
  }
  return out;
}

function strengthOf(m: Medicine): string {
  if (m.strength) return normalizeStrength(m.strength);
  const s = strengthsInUtterance(m.name_en || "");
  return s[0] || "";
}

// ------------------------------------------------------- disambiguation

const ORDINALS: Record<string, number> = {
  first: 1, one: 1, "1st": 1,
  second: 2, two: 2, "2nd": 2,
  third: 3, three: 3, "3rd": 3,
  fourth: 4, four: 4, "4th": 4,
  fifth: 5, five: 5, "5th": 5,
  sixth: 6, six: 6, "6th": 6,
  seventh: 7, seven: 7, "7th": 7,
  eighth: 8, eight: 8, "8th": 8,
  ninth: 9, nine: 9, "9th": 9,
  tenth: 10, ten: 10, "10th": 10,
};

/** Return a 1-based position if the utterance picks an option by number ("number 2", "the second one", "3"). */
export function ordinalInUtterance(text: string, count: number): number | null {
  const t = text.toLowerCase().trim();
  let m = t.match(/^(?:(?:number|option|no\.?|#)\s*)?(\d{1,2})[.)]?$/) || t.match(/\b(?:number|option|no\.?|#)\s*(\d{1,2})\b/);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= count ? n : null;
  }
  if (/\b(last|final)\b/.test(t) && !/\bmg\b/.test(t)) return count;
  m = t.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|1st|2nd|3rd|[4-9]th|10th)\b/);
  if (m) {
    const n = ORDINALS[m[1]];
    return n <= count ? n : null;
  }
  m = t.match(/^(?:the\s+)?(one|two|three|four|five|six|seven|eight|nine|ten)(\s+please)?$/) || t.match(/\bnumber (one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (m) {
    const n = ORDINALS[m[1]];
    return n <= count ? n : null;
  }
  return null;
}

export type ChoiceResult =
  | { kind: "selected"; item: Medicine }
  | { kind: "ambiguous"; candidates: Medicine[] }
  | { kind: "none" };

const STOP = new Set([
  "the", "one", "a", "an", "i", "want", "mean", "meant", "please", "that", "this", "with", "of", "for", "and", "is", "it",
  "pack", "box", "strip", "version", "kind", "type", "option", "mg", "tabs", "tablets", "tablet", "vial", "injection", "alexa",
]);

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(Boolean);
}

/** Resolve the user's reply against the options they were offered. */
export function resolveChoice(text: string, options: Medicine[]): ChoiceResult {
  if (!options.length) return { kind: "none" };
  const pos = ordinalInUtterance(text, options.length);
  if (pos) return { kind: "selected", item: options[pos - 1] };

  let cands = options.slice();
  let constrained = false;

  const strengths = strengthsInUtterance(text);
  if (strengths.length) {
    constrained = true;
    cands = cands.filter((m) => strengths.includes(strengthOf(m)));
  }
  const form = formInUtterance(text);
  if (form) {
    constrained = true;
    cands = cands.filter((m) => inferForm(m) === form);
  }
  // Extra words ("new", a manufacturer name, a pack count) narrow further only if they keep at least one option.
  const extra = words(text.replace(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|%)/gi, " ")).filter((w) => !STOP.has(w) && (w.length >= 3 || /^\d+$/.test(w)));
  for (const w of extra) {
    const narrowed = cands.filter((m) => words(`${m.name_en} ${m.name_ar || ""} ${m.manufacturer || ""}`).includes(w));
    if (narrowed.length) {
      constrained = true;
      cands = narrowed;
    }
  }
  // Prefer an entry without the "new" marker unless the user asked for it.
  if (!constrained || !cands.length) return { kind: "none" };
  if (cands.length === 1) return { kind: "selected", item: cands[0] };
  return { kind: "ambiguous", candidates: cands };
}

// ---------------------------------------------------------------- wording

export function displayName(m: Medicine): string {
  return (m.name_en || m.name_ar || `Catalog #${m.canonical_id}`).replace(/\s+/g, " ").trim();
}

/** Make catalog names easier for speech synthesis ("20MG" -> "20 milligram", "TABS." -> "tablets"). */
export function speakableName(name: string): string {
  return name
    .replace(/(\d+(?:\.\d+)?)\s*MG\b/gi, "$1 milligram")
    .replace(/(\d+(?:\.\d+)?)\s*MCG\b/gi, "$1 microgram")
    .replace(/(\d+(?:\.\d+)?)\s*ML\b/gi, "$1 millilitre")
    .replace(/\bTABS?\.?(?=\s|$)/gi, "tablets")
    .replace(/\bCAPS?\.?(?=\s|$)/gi, "capsules")
    .replace(/\bI\.V\.?/gi, "I V")
    .replace(/\bINF\.?(?=\s|$)/gi, "infusion")
    .replace(/\bE\.C\.?/gi, "enteric coated")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function formatEgp(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(2)} EGP`;
}

export function priceText(p: number | null | undefined): string {
  return typeof p === "number" && Number.isFinite(p) && p > 0 ? formatEgp(p) : "no recorded price";
}

export interface Reply {
  text: string;
  spoken: string;
}

export function disambiguationReply(query: string, options: Medicine[], narrowed = false): Reply & { lead: string; hint: string } {
  const lines = options.map((m, i) => `${i + 1}. ${displayName(m)}`);
  const lead = narrowed
    ? `That still matches ${options.length} entries.`
    : `I found ${options.length} catalog entries for "${query}".`;
  return {
    lead: `${lead} Which one do you mean?`,
    text: `${lead} Which one do you mean?\n${lines.join("\n")}`,
    hint: `Tap one, or say a number, a strength (e.g. "20 mg") or a form (e.g. "vial").`,
    spoken: `${lead} ${options
      .slice(0, 5)
      .map((m, i) => `Number ${i + 1}: ${speakableName(displayName(m))}.`)
      .join(" ")} Which one do you mean?`,
  };
}

export function noMatchReply(query: string): Reply {
  return {
    text: `I couldn't find "${query}" in the MedS Hub catalog. Please check the spelling or try the scientific name.`,
    spoken: `I couldn't find ${query} in the catalog. Please check the spelling or try the scientific name.`,
  };
}

export interface CostLine {
  matched?: boolean;
  canonical_id?: number;
  unit_egp?: number | null;
  name_en?: string;
  url?: string;
}

export interface PriceSummary extends Reply {
  priceEgp: number | null;
  sourceUrl: string | null;
  mismatch: boolean;
}

/** Build the price answer from estimate_cost output. Never invents a price. */
export function priceReply(item: Medicine, estimate: { lines?: CostLine[] } | null): PriceSummary {
  const line = estimate?.lines?.[0];
  const name = displayName(item);
  const sourceUrl = line?.url || item.url || null;
  if (!line || line.matched === false) {
    return {
      priceEgp: null, sourceUrl, mismatch: false,
      text: `The cost tool could not match ${name}, so I have no indicative price to give.`,
      spoken: `The cost tool could not match this product, so I have no indicative price to give.`,
    };
  }
  if (line.canonical_id !== undefined && Number(line.canonical_id) !== Number(item.canonical_id)) {
    return {
      priceEgp: null, sourceUrl, mismatch: true,
      text: `The cost tool returned a different record (#${line.canonical_id}) than the one you picked (#${item.canonical_id}), so I won't quote a price.`,
      spoken: `The cost tool returned a different record, so I won't quote a price.`,
    };
  }
  const p = line.unit_egp;
  const facts = [
    item.manufacturer ? `listed under ${item.manufacturer}` : null,
    item.scientific_name ? `active ingredient ${item.scientific_name}` : null,
  ].filter(Boolean).join(", ");
  if (typeof p !== "number" || !(p > 0)) {
    return {
      priceEgp: null, sourceUrl, mismatch: false,
      text: `${name}${facts ? ` (${facts})` : ""}: the catalog has no recorded price for this item. I won't estimate one.`,
      spoken: `The catalog has no recorded price for ${speakableName(name)}.`,
    };
  }
  return {
    priceEgp: p, sourceUrl, mismatch: false,
    text: `${name}${facts ? ` (${facts})` : ""}. Indicative catalog price: ${formatEgp(p)} for the pack described in the record name. This is a catalog estimate, not a pharmacy quote; the pharmacy price may differ.`,
    spoken: `${speakableName(name)}. The indicative catalog price is ${p} Egyptian pounds. This is a catalog estimate, not a pharmacy quote.`,
  };
}

export interface CompareRow {
  item: Medicine;
  isSelected: boolean;
  differentStrength: boolean;
  differentForm: boolean;
  priceMissing: boolean;
}

export interface CompareSummary extends Reply {
  rows: CompareRow[];
  otherCount: number;
  differentStrengthCount: number;
  differentFormCount: number;
}

export const SWITCH_WARNING =
  "Same scientific name does not mean interchangeable. Strengths and dosage forms can differ. Talk to your doctor or pharmacist before changing any medicine.";

export function compareReply(selected: Medicine, compare: any): CompareSummary {
  const alts: Medicine[] = Array.isArray(compare?.alternatives) ? compare.alternatives : [];
  const selStrength = strengthOf(selected);
  const selForm = inferForm(selected);
  const rows: CompareRow[] = alts.map((m) => {
    const s = strengthOf(m);
    const f = inferForm(m);
    return {
      item: m,
      isSelected: Number(m.canonical_id) === Number(selected.canonical_id),
      differentStrength: !!(selStrength && s && s !== selStrength),
      differentForm: !!(selForm && f && f !== selForm),
      priceMissing: !(typeof m.current_price_egp === "number" && m.current_price_egp > 0),
    };
  });
  const others = rows.filter((r) => !r.isSelected);
  const inn = compare?.scientific_name || selected.scientific_name || "the same scientific name";
  const dS = others.filter((r) => r.differentStrength).length;
  const dF = others.filter((r) => r.differentForm).length;
  if (!compare?.found || !others.length) {
    return {
      rows, otherCount: 0, differentStrengthCount: 0, differentFormCount: 0,
      text: `The catalog lists no other products with ${inn} for this record. ${SWITCH_WARNING}`,
      spoken: `The catalog lists no other products with the same scientific name for this record.`,
    };
  }
  // Use like-for-like entries (same strength and form) as spoken examples when there are any.
  const likeForLike = others.filter((r) => !r.differentStrength && !r.differentForm);
  const examples = (likeForLike.length ? likeForLike : others).slice(0, 2);
  const ex = examples.map((r) => `${displayName(r.item)} (${r.item.strength || "strength not recorded"}, ${priceText(r.item.current_price_egp)})`);
  const diffs: string[] = [];
  if (dS) diffs.push(`${dS} of ${others.length} have a different strength from ${selected.strength || "your pick"}`);
  if (dF) diffs.push(`${dF} ${dF === 1 ? "is a" : "are a"} different dosage form`);
  const missing = others.filter((r) => r.priceMissing).length;
  return {
    rows,
    otherCount: others.length,
    differentStrengthCount: dS,
    differentFormCount: dF,
    text:
      `The catalog lists ${others.length} other product${others.length === 1 ? "" : "s"} with the scientific name ${inn}, for example ${ex.join(" and ")}.` +
      (diffs.length ? ` Note: ${diffs.join("; ")}.` : "") +
      (missing ? ` ${missing} ha${missing === 1 ? "s" : "ve"} no recorded price.` : "") +
      ` Prices are catalog snapshots, not live pharmacy prices or stock. ${SWITCH_WARNING}`,
    spoken:
      `The catalog lists ${others.length} other products with the same scientific name, for example ${examples
        .map((r) => speakableName(displayName(r.item)))
        .join(" and ")}. Strengths and dosage forms may differ. Please talk to your doctor or pharmacist before changing any medicine.`,
  };
}

export function refusalReply(reason: "clinical" | "sensitive_id" | "write"): Reply {
  const text =
    reason === "clinical"
      ? "I can only share catalog information such as names, active ingredients and indicative prices. I can't give dosing, diagnosis, prescribing or switching advice. Please ask your doctor or pharmacist."
      : reason === "sensitive_id"
        ? "Please don't share national ID, insurance policy or card numbers. This demo doesn't need or store them."
        : "This demo is read-only: it can't save, submit, order or change anything. It only looks up catalog information.";
  return { text, spoken: text };
}

export const HELP_REPLY: Reply = {
  text: 'Try: "Alexa, look up Controloc". I\'ll ask which entry you mean, give the indicative catalog price, and on request list other catalog products with the same active ingredient. Information only, not medical advice.',
  spoken: "Try saying: look up Controloc. I'll ask which entry you mean, then give the indicative catalog price.",
};
