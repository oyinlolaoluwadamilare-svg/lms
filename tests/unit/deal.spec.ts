import { describe, expect, it } from "vitest";
import { dealValue, formatDealReference, resolveProbability, weightedValue } from "../../src/domain/deal";
import { parseMoneyMinor, toMinorUnits } from "../../src/domain/money";

const STAGE = { probabilityThreshold: 40 };

describe("resolveProbability", () => {
  it("uses the stage's probability threshold when there is no override", () => {
    const deal = { proposalValueMinor: null, negotiatedValueMinor: null, currencyCode: "NGN", probabilityOverride: null };
    expect(resolveProbability(deal, STAGE)).toBe(40);
  });

  it("uses the override when present, even if it differs from the stage threshold", () => {
    const deal = { proposalValueMinor: null, negotiatedValueMinor: null, currencyCode: "NGN", probabilityOverride: 75 };
    expect(resolveProbability(deal, STAGE)).toBe(75);
  });

  it("treats an override of exactly 0 as a real override, not as absent", () => {
    const deal = { proposalValueMinor: null, negotiatedValueMinor: null, currencyCode: "NGN", probabilityOverride: 0 };
    expect(resolveProbability(deal, STAGE)).toBe(0);
  });
});

describe("dealValue", () => {
  it("prefers negotiated value over proposal value", () => {
    const deal = {
      proposalValueMinor: 100_000n,
      negotiatedValueMinor: 80_000n,
      currencyCode: "NGN",
      probabilityOverride: null,
    };
    expect(dealValue(deal)).toEqual({ amountMinor: 80_000n, currency: "NGN" });
  });

  it("falls back to proposal value when there is no negotiated value", () => {
    const deal = { proposalValueMinor: 100_000n, negotiatedValueMinor: null, currencyCode: "NGN", probabilityOverride: null };
    expect(dealValue(deal)).toEqual({ amountMinor: 100_000n, currency: "NGN" });
  });

  it("returns null (not zero) when neither value is set", () => {
    const deal = { proposalValueMinor: null, negotiatedValueMinor: null, currencyCode: "NGN", probabilityOverride: null };
    expect(dealValue(deal)).toBeNull();
  });
});

describe("weightedValue", () => {
  it("multiplies the resolved value by the resolved probability", () => {
    const deal = {
      proposalValueMinor: 1_000_000n,
      negotiatedValueMinor: null,
      currencyCode: "NGN",
      probabilityOverride: null,
    };
    expect(weightedValue(deal, { probabilityThreshold: 25 })).toEqual({ amountMinor: 250_000n, currency: "NGN" });
  });

  it("is null when the deal has no value to weight", () => {
    const deal = { proposalValueMinor: null, negotiatedValueMinor: null, currencyCode: "NGN", probabilityOverride: null };
    expect(weightedValue(deal, STAGE)).toBeNull();
  });

  it("truncates a sub-minor-unit remainder toward zero rather than rounding", () => {
    const deal = { proposalValueMinor: 999n, negotiatedValueMinor: null, currencyCode: "NGN", probabilityOverride: 33 };
    // 999 * 33 / 100 = 329.67 -> 329 (bigint division truncates)
    expect(weightedValue(deal, STAGE)).toEqual({ amountMinor: 329n, currency: "NGN" });
  });
});

describe("formatDealReference", () => {
  it("zero-pads to 4 digits", () => {
    expect(formatDealReference(1)).toBe("D-0001");
    expect(formatDealReference(42)).toBe("D-0042");
  });

  it("does not truncate a number wider than 4 digits", () => {
    expect(formatDealReference(12345)).toBe("D-12345");
  });

  it("rejects zero, negative and non-integer sequence numbers", () => {
    expect(() => formatDealReference(0)).toThrow();
    expect(() => formatDealReference(-1)).toThrow();
    expect(() => formatDealReference(1.5)).toThrow();
  });
});

describe("parseMoneyMinor", () => {
  it("parses a text-cast bigint value exactly, beyond Number.MAX_SAFE_INTEGER", () => {
    // The exact case that motivated the ::text cast requirement in src/data/deals.ts - this value
    // is not representable exactly as a JS number.
    expect(parseMoneyMinor("9007199254740993")).toBe(9_007_199_254_740_993n);
  });

  it("returns null for a null input rather than throwing", () => {
    expect(parseMoneyMinor(null)).toBeNull();
  });
});

describe("toMinorUnits", () => {
  it("converts a whole-number major amount", () => {
    expect(toMinorUnits("1500000")).toBe(150_000_000n);
  });

  it("converts an amount with cents", () => {
    expect(toMinorUnits("1500000.50")).toBe(150_000_050n);
  });

  it("pads a single decimal digit", () => {
    expect(toMinorUnits("10.5")).toBe(1_050n);
  });

  it("rejects more decimal places than the currency supports", () => {
    expect(() => toMinorUnits("10.123")).toThrow();
  });

  it("rejects a non-numeric amount", () => {
    expect(() => toMinorUnits("abc")).toThrow();
    expect(() => toMinorUnits("-5")).toThrow();
  });
});
