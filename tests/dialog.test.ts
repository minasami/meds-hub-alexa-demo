import { describe, it, expect } from "vitest";
import {
  parseIntent, extractMedicineQuery, resolveChoice, inferForm, priceReply, compareReply, ordinalInUtterance, speakableName,
} from "../src/dialog";
import { CONTROLOC } from "./fixtures/controloc";

const idle = { awaitingChoice: false, hasSelection: false };
const choosing = { awaitingChoice: true, hasSelection: false };
const selected = { awaitingChoice: false, hasSelection: true };

describe("intent parsing", () => {
  it("extracts the medicine name", () => {
    expect(extractMedicineQuery("Alexa, look up Controloc.")).toBe("Controloc");
    expect(extractMedicineQuery("hey alexa how much is Controloc please?")).toBe("Controloc");
    expect(extractMedicineQuery("check the price of Antopral")).toBe("Antopral");
    expect(extractMedicineQuery("كونترولوك")).toBe("كونترولوك");
  });
  it("routes intents", () => {
    expect(parseIntent("Alexa, look up Controloc", idle)).toEqual({ type: "lookup", query: "Controloc" });
    expect(parseIntent("Are there other products with the same active ingredient?", selected)).toEqual({ type: "compare" });
    expect(parseIntent("number 2", choosing)).toEqual({ type: "choose", text: "number 2" });
    expect(parseIntent("look up Antopral", choosing)).toEqual({ type: "lookup", query: "Antopral" });
    expect(parseIntent("start over", selected)).toEqual({ type: "reset" });
    expect(parseIntent("", idle)).toEqual({ type: "empty" });
  });
  it("refuses clinical, sensitive and write requests", () => {
    expect(parseIntent("What dose of Controloc should I take?", idle)).toEqual({ type: "refuse", reason: "clinical" });
    expect(parseIntent("Can I switch to Antopral?", selected)).toEqual({ type: "refuse", reason: "clinical" });
    expect(parseIntent("my national id is 29801011234567", idle)).toEqual({ type: "refuse", reason: "sensitive_id" });
    expect(parseIntent("add it to my watchlist", selected)).toEqual({ type: "refuse", reason: "write" });
  });
});

describe("disambiguation (Controloc: 4 entries)", () => {
  it("infers forms from names when dosage_form is empty", () => {
    expect(CONTROLOC.map(inferForm)).toEqual(["tablet", "tablet", "injection", "tablet"]);
  });
  it("picks by number and ordinal", () => {
    expect(ordinalInUtterance("the third one", 4)).toBe(3);
    expect(ordinalInUtterance("number 9", 4)).toBe(null);
    expect(resolveChoice("2", CONTROLOC)).toEqual({ kind: "selected", item: CONTROLOC[1] });
    expect(resolveChoice("the last one", CONTROLOC)).toEqual({ kind: "selected", item: CONTROLOC[3] });
  });
  it("picks by strength when unique", () => {
    expect(resolveChoice("the 20 mg one", CONTROLOC)).toEqual({ kind: "selected", item: CONTROLOC[0] });
  });
  it("picks by form", () => {
    expect(resolveChoice("the IV vial", CONTROLOC)).toEqual({ kind: "selected", item: CONTROLOC[2] });
  });
  it("narrows but stays ambiguous for 40 mg tablets, then resolves 'new'", () => {
    const r = resolveChoice("40 mg tablets", CONTROLOC);
    expect(r.kind).toBe("ambiguous");
    if (r.kind !== "ambiguous") return;
    expect(r.candidates.map((m) => m.canonical_id)).toEqual([15009, 84890]);
    expect(resolveChoice("the new one", r.candidates)).toEqual({ kind: "selected", item: CONTROLOC[3] });
  });
  it("returns none for unrelated replies or impossible strengths", () => {
    expect(resolveChoice("hmm not sure", CONTROLOC).kind).toBe("none");
    expect(resolveChoice("80 mg", CONTROLOC).kind).toBe("none");
  });
});

describe("price and comparison wording", () => {
  const item = CONTROLOC[0];
  it("quotes the tool price with a non-quote caveat", () => {
    const r = priceReply(item, { lines: [{ matched: true, canonical_id: 15008, unit_egp: 100, url: item.url }] });
    expect(r.priceEgp).toBe(100);
    expect(r.text).toContain("100 EGP");
    expect(r.text).toMatch(/not a pharmacy quote/);
    expect(r.sourceUrl).toBe("https://medicinesupport.app/catalog/15008");
  });
  it("never invents a missing price", () => {
    const r = priceReply(item, { lines: [{ matched: true, canonical_id: 15008, unit_egp: null }] });
    expect(r.priceEgp).toBeNull();
    expect(r.text).toMatch(/no recorded price/);
    expect(r.text).not.toMatch(/\d+ EGP/);
  });
  it("refuses to quote when the tool returns a different record", () => {
    const r = priceReply(item, { lines: [{ matched: true, canonical_id: 99, unit_egp: 12 }] });
    expect(r.mismatch).toBe(true);
    expect(r.priceEgp).toBeNull();
  });
  it("flags strength and form differences in same-INN results", () => {
    const compare = {
      found: true,
      scientific_name: "PANTOPRAZOLE",
      alternatives: [
        { canonical_id: 11332, name_en: "ANTOPRAL 40MG POWDER FOR I.V. INF. VIAL", strength: "40mg", current_price_egp: 59.5 },
        { canonical_id: 11330, name_en: "ANTOPRAL 20 MG 14 TAB.", strength: "20mg", current_price_egp: 88 },
        { canonical_id: 15704, name_en: "DELPANTO 20MG 14 E.C.TABS.", strength: "20mg", current_price_egp: null },
        { ...item },
      ],
    };
    const c = compareReply(item, compare);
    expect(c.otherCount).toBe(3);
    expect(c.differentStrengthCount).toBe(1);
    expect(c.differentFormCount).toBe(1);
    expect(c.text).toMatch(/does not mean interchangeable/);
    expect(c.text).toMatch(/1 has no recorded price/);
    expect(c.text).toContain("ANTOPRAL 20 MG 14 TAB.");
    expect(c.rows.find((r) => r.item.canonical_id === 15704)?.priceMissing).toBe(true);
  });
  it("handles an empty comparison honestly", () => {
    expect(compareReply(item, { found: false }).text).toMatch(/no other products/);
  });
  it("makes names speakable", () => {
    expect(speakableName("CONTROLOC 20MG 14 GASTRO-RESISTANT TABS.")).toBe("controloc 20 milligram 14 gastro-resistant tablets");
  });
});
