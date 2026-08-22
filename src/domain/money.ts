// CLAUDE.md #9: money is never a float. Stored as bigint minor units plus a currency code,
// everywhere - including here, in memory, not just in Postgres.
export interface Money {
  amountMinor: bigint;
  currency: string;
}

// Every repository selecting a bigint column through PostgREST (the Supabase client) MUST cast it
// to text in the select string (`"proposal_value_minor::text"`, not `"proposal_value_minor"`).
// Verified directly against this project's real REST endpoint: PostgREST serialises a plain
// bigint/int8 column as a bare JSON number, and a value like 9007199254740993 (just above
// Number.MAX_SAFE_INTEGER) silently loses precision the moment the response body is JSON.parsed -
// before any TypeScript code runs, so BigInt(row.value) on the parsed result cannot recover it.
// Casting to text in the select forces PostgREST to return a quoted string instead, which parses
// exactly. This function is the single place that parse happens, so a caller can't reach for
// Number(...)/BigInt(...) directly and reintroduce the bug.
export function parseMoneyMinor(textValue: string | null): bigint | null {
  if (textValue === null) return null;
  return BigInt(textValue);
}

// Converts a decimal major-unit amount as a human types it (e.g. "1500000.50") to minor units.
// Assumes 2 decimal places - true for NGN/USD/GBP, the "reasonable starting list" named in
// docs/DECISIONS.md D-08b, which is itself still an open question (which currencies a tenant may
// use at all is not yet decided). A zero-decimal or three-decimal currency would need this
// parameterised per currency, not assumed universal - not built now since no such currency is
// enabled anywhere yet.
export function toMinorUnits(majorAmount: string, decimalPlaces = 2): bigint {
  const trimmed = majorAmount.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new Error(`invalid decimal amount: "${majorAmount}"`);
  }
  // match[1] is guaranteed present whenever match succeeds - the first capture group (\d+) is
  // mandatory, unlike the optional fractional group.
  const whole = match[1]!;
  const fraction = match[2] ?? "";
  if (fraction.length > decimalPlaces) {
    throw new Error(`"${majorAmount}" has more than ${decimalPlaces} decimal places`);
  }
  const paddedFraction = fraction.padEnd(decimalPlaces, "0");
  return BigInt(whole) * 10n ** BigInt(decimalPlaces) + BigInt(paddedFraction || "0");
}

// For display only (the pipeline table, deal detail). Deliberately does not go through
// Number/Intl currency formatting - Intl's currency formatter takes a JS number, which would
// round-trip amountMinor through float and reintroduce exactly the precision loss CLAUDE.md #9
// forbids. BigInt.prototype.toLocaleString formats an arbitrarily large integer with grouping
// separators without ever converting it to a float, so the whole-units part is exact; the minor
// units are split off first via bigint division/modulo, never floating-point division.
export function formatMoney(money: Money, decimalPlaces = 2): string {
  const divisor = 10n ** BigInt(decimalPlaces);
  const whole = money.amountMinor / divisor;
  const fraction = money.amountMinor % divisor;
  const fractionStr = fraction.toString().padStart(decimalPlaces, "0");
  return `${money.currency} ${whole.toLocaleString("en-US")}.${fractionStr}`;
}

// For Account 360's tiles (M5.8: "open pipeline, won revenue"), which sum a Money value across
// several deals that could in principle carry different currencies - D-08b (which currencies a
// tenant may enable, and its own reporting-currency default) is still an open question, and no FX
// conversion exists anywhere in this codebase yet (D-08's own note: the rate source itself is only
// decided in principle, not built). Rather than silently picking one currency and dropping the
// rest, or inventing a conversion this codebase has no rate source for, this returns one Money per
// distinct currency actually present - typically a single entry in practice (every seed/demo tenant
// uses one currency today), but never silently lossy if that ever stops being true. Sorted by
// currency code for a deterministic render order.
export function sumMoneyByCurrency(values: Array<Money | null>): Money[] {
  const totals = new Map<string, bigint>();
  for (const value of values) {
    if (value === null) continue;
    totals.set(value.currency, (totals.get(value.currency) ?? 0n) + value.amountMinor);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amountMinor]) => ({ amountMinor, currency }));
}

// The exact inverse of toMinorUnits - for pre-filling an editable amount input with the deal's
// current value (M1.7's edit form), where a currency prefix and thousands separators would just be
// noise the user has to delete before typing a new amount. No toLocaleString grouping here on
// purpose, for the same reason: an edit field should round-trip back through toMinorUnits exactly,
// which grouping separators would break.
export function toMajorUnitsString(amountMinor: bigint, decimalPlaces = 2): string {
  const divisor = 10n ** BigInt(decimalPlaces);
  const whole = amountMinor / divisor;
  const fraction = amountMinor % divisor;
  return `${whole}.${fraction.toString().padStart(decimalPlaces, "0")}`;
}
