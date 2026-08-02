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
// block for every "whole days" calculation in this app, and also directly usable wherever a
// caller needs "what calendar date is it right now, for this user" as a plain YYYY-MM-DD string -
// e.g. validating a DATE column (itself YYYY-MM-DD, lexicographically sortable) against "today".
// en-CA is just the shortest built-in Intl locale that formats this way; nothing Canada-specific
// about it.
export function dateInTimezone(isoInstant: string, timezone: string): string {
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
  const sinceUtc = Date.parse(`${dateInTimezone(sinceISO, timezone)}T00:00:00Z`);
  const untilUtc = Date.parse(`${dateInTimezone(untilISO, timezone)}T00:00:00Z`);
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

// CLAUDE.md #8's default date display format, DD/MM/YYYY, for a plain DATE value (YYYY-MM-DD, e.g.
// activities.activity_date) that has no time-of-day or timezone component at all - there is no
// instant to resolve here, just re-ordering the same three digit groups, so this is deliberately
// NOT built on formatDateInTimezone/Date/Intl: parsing a bare date string into a Date and
// re-formatting it risks exactly the off-by-one-day bug this file's other functions exist to
// prevent, if a caller ever mis-supplied a timezone. Plain string manipulation has no such risk.
export function formatPlainDate(yyyyMmDd: string): string {
  const [year, month, day] = yyyyMmDd.split("-");
  return `${day}/${month}/${year}`;
}

// A plain YYYY-MM-DD string always splits into exactly three numeric parts - the non-null
// assertions below trust that shape (every caller in this file already validates or produces it),
// not an unchecked assumption about arbitrary input.
function parsePlainDateUtcMs(yyyyMmDd: string): number {
  const [year, month, day] = yyyyMmDd.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!);
}

// Whole calendar days between two plain DATE values (YYYY-MM-DD, no time-of-day or timezone
// component at all - e.g. deals.last_engaged_at, the same shape as activities.activity_date) -
// deliberately NOT built on daysBetweenInTimezone, which resolves TIMESTAMPTZ instants through a
// timezone and would risk exactly the off-by-one-day bug formatPlainDate's own comment warns
// against if a caller ever mis-supplied one. Plain Date.UTC arithmetic on the two date strings
// has no such risk. Never negative, same clamping reasoning as daysBetweenInTimezone.
export function daysSincePlainDate(date: string, today: string): number {
  return Math.max(0, Math.round((parsePlainDateUtcMs(today) - parsePlainDateUtcMs(date)) / DAY_MS));
}

// The cutoff-date counterpart to daysSincePlainDate - turns a "days since last engagement" filter
// input into a last_engaged_at.lte(...) cutoff a SQL query can use directly. Same plain Date.UTC
// arithmetic, same no-timezone-to-resolve reasoning.
export function subtractDaysFromPlainDate(date: string, days: number): string {
  const cutoff = new Date(parsePlainDateUtcMs(date) - days * DAY_MS);
  const yyyy = cutoff.getUTCFullYear().toString().padStart(4, "0");
  const mm = (cutoff.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = cutoff.getUTCDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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
