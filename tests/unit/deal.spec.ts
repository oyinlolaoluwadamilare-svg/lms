import { describe, expect, it } from "vitest";
import {
  dealValue,
  formatDealReference,
  formatLastEngaged,
  isOpenStage,
  resolveProbability,
  stalenessBand,
  valueBand,
  weightedValue,
} from "../../src/domain/deal";
import { formatMoney, parseMoneyMinor, toMajorUnitsString, toMinorUnits } from "../../src/domain/money";

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

// docs/04-metric-definitions.md "Value bands" (flagged there, and in docs/DECISIONS.md's D-12, as
// an unconfirmed default) - boundaries in NGN minor units (kobo): under 5,000,000 / 500,000,000
// minor.
describe("valueBand", () => {
  it("returns not_recorded for null, never folding it into the lowest band", () => {
    expect(valueBand(null)).toBe("not_recorded");
  });

  it("returns under_5m for zero and for values just below the boundary", () => {
    expect(valueBand(0n)).toBe("under_5m");
    expect(valueBand(499_999_999n)).toBe("under_5m");
  });

  it("returns 5m_25m at the lower boundary and just below the upper one", () => {
    expect(valueBand(500_000_000n)).toBe("5m_25m");
    expect(valueBand(2_499_999_999n)).toBe("5m_25m");
  });

  it("returns 25m_100m at the lower boundary and just below the upper one", () => {
    expect(valueBand(2_500_000_000n)).toBe("25m_100m");
    expect(valueBand(9_999_999_999n)).toBe("25m_100m");
  });

  it("returns 100m_plus at the boundary and for arbitrarily large values", () => {
    expect(valueBand(10_000_000_000n)).toBe("100m_plus");
    expect(valueBand(999_999_999_999n)).toBe("100m_plus");
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

describe("formatMoney", () => {
  it("formats a whole-number amount with two decimal places", () => {
    expect(formatMoney({ amountMinor: 150_000_000n, currency: "NGN" })).toBe("NGN 1,500,000.00");
  });

  it("formats an amount with cents and thousands separators", () => {
    expect(formatMoney({ amountMinor: 150_000_050n, currency: "NGN" })).toBe("NGN 1,500,000.50");
  });

  it("pads a fraction under two digits", () => {
    expect(formatMoney({ amountMinor: 1_005n, currency: "NGN" })).toBe("NGN 10.05");
  });

  it("does not lose precision for a value beyond Number.MAX_SAFE_INTEGER", () => {
    // The exact value that motivated the ::text cast requirement (src/domain/money.ts) - if this
    // ever round-tripped through a JS number, the assertion below would fail.
    expect(formatMoney({ amountMinor: 9_007_199_254_740_993n, currency: "NGN" })).toBe("NGN 90,071,992,547,409.93");
  });

  it("formats a zero amount", () => {
    expect(formatMoney({ amountMinor: 0n, currency: "NGN" })).toBe("NGN 0.00");
  });
});

describe("isOpenStage", () => {
  it("is true only for an open stage", () => {
    expect(isOpenStage("open")).toBe(true);
  });

  it("is false for won and lost - changeStage must refuse these, closeDeal (M5.2) owns them", () => {
    expect(isOpenStage("won")).toBe(false);
    expect(isOpenStage("lost")).toBe(false);
  });
});

describe("toMajorUnitsString", () => {
  it("is the exact inverse of toMinorUnits for a whole-number amount", () => {
    const minor = toMinorUnits("1500000");
    expect(toMajorUnitsString(minor)).toBe("1500000.00");
  });

  it("is the exact inverse of toMinorUnits for an amount with cents", () => {
    const minor = toMinorUnits("1500000.50");
    expect(toMajorUnitsString(minor)).toBe("1500000.50");
  });

  it("round-trips back through toMinorUnits to the same bigint - no float involved either way", () => {
    const original = 9_007_199_254_740_993n; // beyond Number.MAX_SAFE_INTEGER
    expect(toMinorUnits(toMajorUnitsString(original))).toBe(original);
  });

  it("never emits thousands separators - an edit field must parse back cleanly", () => {
    expect(toMajorUnitsString(150_000_000n)).toBe("1500000.00");
  });
});

// docs/04-metric-definitions.md's "Staleness bands": "0-7 days green, 8-21 blue, 22-45 amber, 46 or
// more red." Boundary values asserted on both sides of every threshold, the same "prove the edge,
// not just the middle" discipline every other band/threshold test in this codebase already follows.
describe("stalenessBand", () => {
  it("null (never engaged) is its own distinct band, not folded into the 46+ band", () => {
    expect(stalenessBand(null)).toBe("never");
  });

  it("0-7 days is fresh", () => {
    expect(stalenessBand(0)).toBe("fresh");
    expect(stalenessBand(7)).toBe("fresh");
  });

  it("8-21 days is ok", () => {
    expect(stalenessBand(8)).toBe("ok");
    expect(stalenessBand(21)).toBe("ok");
  });

  it("22-45 days is warn", () => {
    expect(stalenessBand(22)).toBe("warn");
    expect(stalenessBand(45)).toBe("warn");
  });

  it("46+ days is cold", () => {
    expect(stalenessBand(46)).toBe("cold");
    expect(stalenessBand(400)).toBe("cold");
  });
});

describe("formatLastEngaged", () => {
  it("renders 'Never engaged' for null, per docs/06-ui-spec.md's deal header chip wording", () => {
    expect(formatLastEngaged(null)).toBe("Never engaged");
  });

  it("renders 'Last engaged today' for zero days", () => {
    expect(formatLastEngaged(0)).toBe("Last engaged today");
  });

  it("renders singular 'day' for exactly one day", () => {
    expect(formatLastEngaged(1)).toBe("Last engaged 1 day ago");
  });

  it("renders plural 'days' otherwise, matching docs/06-ui-spec.md's own example", () => {
    expect(formatLastEngaged(12)).toBe("Last engaged 12 days ago");
  });
});
