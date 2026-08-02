import { describe, expect, it } from "vitest";
import { daysBetweenInTimezone, formatDateInTimezone, formatDurationSeconds, resolveTimezone } from "@/lib/dates";

describe("resolveTimezone", () => {
  it("uses the user's own override when set", () => {
    expect(resolveTimezone("Africa/Lagos", "America/New_York")).toBe("America/New_York");
  });

  it("falls back to the tenant's default when the user has no override", () => {
    expect(resolveTimezone("Africa/Lagos", null)).toBe("Africa/Lagos");
  });
});

describe("daysBetweenInTimezone", () => {
  it("is zero for the same instant", () => {
    expect(daysBetweenInTimezone("2026-03-09T12:00:00Z", "2026-03-09T12:00:00Z", "UTC")).toBe(0);
  });

  it("is zero for two instants on the same UTC calendar day, regardless of hours elapsed", () => {
    expect(daysBetweenInTimezone("2026-03-09T01:00:00Z", "2026-03-09T23:00:00Z", "UTC")).toBe(0);
  });

  it("counts a real calendar-day crossing in UTC", () => {
    expect(daysBetweenInTimezone("2026-03-09T22:00:00Z", "2026-03-10T02:00:00Z", "UTC")).toBe(1);
  });

  // CLAUDE.md #8's own example, and docs/07-build-backlog.md M3.9's named test case: "an activity
  // logged at 23:30 WAT renders the correct local date" - the predecessor product's exact class of
  // defect. Only 30 minutes of real elapsed time here, but it crosses local midnight in WAT
  // (UTC+1) even though both instants fall on the SAME calendar day in UTC - proving this isn't a
  // naive UTC day-diff mislabelled as timezone-aware.
  it("crosses a day boundary in Africa/Lagos (WAT, UTC+1) that UTC itself does not show", () => {
    const sinceISO = "2026-03-09T22:45:00Z"; // 23:45 WAT, 9 March
    const untilISO = "2026-03-09T23:15:00Z"; // 00:15 WAT, 10 March - only 30 minutes later
    expect(daysBetweenInTimezone(sinceISO, untilISO, "UTC")).toBe(0);
    expect(daysBetweenInTimezone(sinceISO, untilISO, "Africa/Lagos")).toBe(1);
  });

  // The reverse divergence, with a negative-offset zone, so this isn't coincidentally only correct
  // for positive offsets: the same pair of instants counts as a day crossing in UTC but not yet in
  // America/Los_Angeles (UTC-8).
  it("does NOT cross a day boundary in a negative-offset zone where UTC does", () => {
    const sinceISO = "2026-01-01T22:00:00Z";
    const untilISO = "2026-01-02T02:00:00Z"; // 4 hours later
    expect(daysBetweenInTimezone(sinceISO, untilISO, "UTC")).toBe(1);
    expect(daysBetweenInTimezone(sinceISO, untilISO, "America/Los_Angeles")).toBe(0);
  });

  it("clamps a negative span (since later than until) to zero rather than returning a negative count", () => {
    expect(daysBetweenInTimezone("2026-03-10T00:00:00Z", "2026-03-09T00:00:00Z", "Africa/Lagos")).toBe(0);
  });

  it("counts several whole days correctly", () => {
    expect(daysBetweenInTimezone("2026-03-01T08:00:00Z", "2026-03-08T08:00:00Z", "Africa/Lagos")).toBe(7);
  });
});

describe("formatDateInTimezone", () => {
  it("renders DD/MM/YYYY - CLAUDE.md #8's default format", () => {
    expect(formatDateInTimezone("2026-03-09T12:00:00Z", "UTC")).toBe("09/03/2026");
  });

  it("renders the LOCAL calendar date, not the UTC one, when the timezone shifts it", () => {
    // 23:45 UTC on 9 March is already 00:45 on 10 March in Africa/Lagos (UTC+1).
    expect(formatDateInTimezone("2026-03-09T23:45:00Z", "UTC")).toBe("09/03/2026");
    expect(formatDateInTimezone("2026-03-09T23:45:00Z", "Africa/Lagos")).toBe("10/03/2026");
  });
});

describe("formatDurationSeconds", () => {
  it("renders sub-minute spans as 'under a minute'", () => {
    expect(formatDurationSeconds(30)).toBe("under a minute");
    expect(formatDurationSeconds(0)).toBe("under a minute");
  });

  it("renders whole minutes, singular and plural", () => {
    expect(formatDurationSeconds(60)).toBe("1 minute");
    expect(formatDurationSeconds(120)).toBe("2 minutes");
  });

  it("renders whole hours once at least one has elapsed", () => {
    expect(formatDurationSeconds(3600)).toBe("1 hour");
    expect(formatDurationSeconds(7200)).toBe("2 hours");
  });

  it("renders whole days once at least 24 hours have elapsed", () => {
    expect(formatDurationSeconds(86_400)).toBe("1 day");
    expect(formatDurationSeconds(86_400 * 3)).toBe("3 days");
  });
});
