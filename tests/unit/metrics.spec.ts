import { describe, expect, it } from "vitest";
import { withMinimumSample } from "../../src/domain/metrics";

describe("withMinimumSample", () => {
  it("returns insufficient_data below the minimum, without ever calling computeValue", () => {
    let called = false;
    const result = withMinimumSample(19, 20, () => {
      called = true;
      return 1;
    });
    expect(result).toEqual({ status: "insufficient_data", sampleSize: 19, minimumRequired: 20 });
    expect(called).toBe(false);
  });

  it("returns ok exactly at the minimum - the boundary is inclusive", () => {
    const result = withMinimumSample(20, 20, () => 0.6);
    expect(result).toEqual({ status: "ok", value: 0.6, sampleSize: 20 });
  });

  it("returns ok above the minimum", () => {
    const result = withMinimumSample(41, 20, () => 12 / 41);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.value).toBeCloseTo(12 / 41);
  });

  it("a sample size of zero is insufficient, never computed as a 0/0 value", () => {
    let called = false;
    const result = withMinimumSample(0, 20, () => {
      called = true;
      return 0;
    });
    expect(result).toEqual({ status: "insufficient_data", sampleSize: 0, minimumRequired: 20 });
    expect(called).toBe(false);
  });
});
