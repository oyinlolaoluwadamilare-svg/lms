import { describe, expect, it } from "vitest";
import { lastEngagedSortHref, viewToggleHref } from "../../src/lib/pipelineViewLinks";

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

// M3.7's "last-engaged column and sort" (docs/06-ui-spec.md) - the app's first sort control.
describe("lastEngagedSortHref", () => {
  it("first click sorts ascending (most-stale-first)", () => {
    expect(lastEngagedSortHref({})).toBe("/deals?sort=lastEngaged&dir=asc");
  });

  it("a second click while already sorted ascending toggles to descending", () => {
    expect(lastEngagedSortHref({ sort: "lastEngaged", dir: "asc" })).toBe("/deals?sort=lastEngaged&dir=desc");
  });

  it("a third click while sorted descending toggles back to ascending", () => {
    expect(lastEngagedSortHref({ sort: "lastEngaged", dir: "desc" })).toBe("/deals?sort=lastEngaged&dir=asc");
  });

  it("clicking while sorted with no explicit dir (defaults to asc) toggles to descending", () => {
    expect(lastEngagedSortHref({ sort: "lastEngaged" })).toBe("/deals?sort=lastEngaged&dir=desc");
  });

  it("preserves every other current filter, the same as viewToggleHref", () => {
    expect(lastEngagedSortHref({ status: "active", owner: "u1" })).toBe("/deals?status=active&owner=u1&sort=lastEngaged&dir=asc");
  });

  it("omits empty-string filter values rather than emitting a bare '='", () => {
    expect(lastEngagedSortHref({ status: "" })).toBe("/deals?sort=lastEngaged&dir=asc");
  });
});
