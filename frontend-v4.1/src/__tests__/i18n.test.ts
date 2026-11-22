import { describe, expect, it } from "vitest";
import { en } from "../i18n/en";
import { fr } from "../i18n/fr";

describe("i18n dictionaries", () => {
  it("en has exact key parity with fr", () => {
    const frKeys = Object.keys(fr).sort();
    const enKeys = Object.keys(en).sort();
    expect(enKeys).toEqual(frKeys);
  });

  it("every translation value is non-empty", () => {
    for (const [k, v] of Object.entries(fr)) {
      expect(v.trim().length, `fr[${k}] empty`).toBeGreaterThan(0);
    }
    for (const [k, v] of Object.entries(en)) {
      expect(v.trim().length, `en[${k}] empty`).toBeGreaterThan(0);
    }
  });
});
