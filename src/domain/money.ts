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
