// Cross-cutting date/timezone helpers (CLAUDE.md #8: "Timestamps stored in UTC, rendered in the
// user's timezone. Default tenant timezone is Africa/Lagos (WAT, UTC+1)."). Pure functions, no I/O.

const DAY_MS = 24 * 60 * 60 * 1000;

// A user's own timezone (users.timezone) overrides their tenant's default (tenants.timezone) -
// docs/01-domain-model.md's users table carries this override column precisely so someone working
// from a different timezone than their tenant's default isn't stuck with the wrong one.
export function resolveTimezone(tenantTimezone: string, userTimezone: string | null): string {
  return userTimezone ?? tenantTimezone;
}

// The calendar date (YYYY-MM-DD) `isoInstant` falls on in the given IANA timezone - the building
// block for every "whole days" calculation in this app. en-CA is just the shortest built-in
// Intl locale that formats as YYYY-MM-DD; nothing Canada-specific about it.
function calendarDateInTimezone(isoInstant: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(isoInstant),
  );
}

// Whole calendar days between two instants, each resolved to its calendar date in `timezone`
// first - never a raw millisecond difference divided by 86400, which silently gives the wrong
// answer whenever the timezone's offset puts the two instants on different calendar dates than a
// naive UTC subtraction would suggest (the exact class of bug CLAUDE.md #8 exists to prevent: e.g.
// an instant at 23:30 UTC is already the next calendar day in WAT, UTC+1). Never negative: a
// `sinceISO` later than `untilISO` (clock skew, or a reconstructed/backdated event) clamps to zero
// rather than rendering a nonsensical "-1 days".
export function daysBetweenInTimezone(sinceISO: string, untilISO: string, timezone: string): number {
  const sinceUtc = Date.parse(`${calendarDateInTimezone(sinceISO, timezone)}T00:00:00Z`);
  const untilUtc = Date.parse(`${calendarDateInTimezone(untilISO, timezone)}T00:00:00Z`);
  return Math.max(0, Math.round((untilUtc - sinceUtc) / DAY_MS));
}

// CLAUDE.md #8's default date display format, DD/MM/YYYY, rendered in the given timezone - en-GB
// is just the shortest built-in Intl locale that formats this way, nothing British-specific about
// it. Deliberately does not read tenants.date_format/users.date_format: no document in this repo
// specifies what alternate format strings those columns may hold or how a caller would select
// between them, so implementing an override here would be inventing a business rule rather than
// following one - flagged as an open question rather than guessed, not yet worth blocking on since
// every caller today only needs the documented default.
export function formatDateInTimezone(isoInstant: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(isoInstant),
  );
}

// A human-readable rendering of a stage_events.duration_in_previous_seconds value - whole days once
// it's at least one, else whole hours, else whole minutes, else "under a minute". Presentational
// only (how to phrase a number of seconds), not an analytic metric formula - docs/04-metric-
// definitions.md's own "Time in stage" metric already defines the STATISTIC (median duration); this
// just renders one already-computed value for the stage-history panel.
export function formatDurationSeconds(totalSeconds: number): string {
  if (totalSeconds < 60) return "under a minute";
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}
