import { describe, expect, it } from "vitest";
import { viewToggleHref } from "../../src/lib/pipelineViewLinks";

describe("viewToggleHref", () => {
  it("links to the bare /deals for table with no filters applied", () => {
    expect(viewToggleHref({}, "table")).toBe("/deals");
  });

  it("adds view=board for the board target", () => {
    expect(viewToggleHref({}, "board")).toBe("/deals?view=board");
  });

  it("preserves every current filter when switching to board", () => {
    expect(viewToggleHref({ status: "active", owner: "u1" }, "board")).toBe("/deals?status=active&owner=u1&view=board");
  });

  it("drops the previous view param, never doubling it, when switching to table", () => {
    expect(viewToggleHref({ status: "active", view: "board" }, "table")).toBe("/deals?status=active");
  });

  it("omits empty-string filter values rather than emitting a bare '='", () => {
    expect(viewToggleHref({ status: "", owner: "u1" }, "table")).toBe("/deals?owner=u1");
  });
});
