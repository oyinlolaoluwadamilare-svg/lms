import pg from "pg";

// Local/CI defaults match scripts/db-bootstrap-local.sh. Override via env for a different target
// (e.g. a CI Postgres service container) - never point AUTHENTICATED_DATABASE_URL at a role with
// superuser/table-owner privileges, or RLS silently stops applying.
const DB_NAME = process.env.DB_NAME ?? "pipeline_intelligence";
export const MIGRATOR_URL =
  process.env.MIGRATOR_DATABASE_URL ??
  `postgres://app_migrator:migrator_local_dev@localhost:5432/${DB_NAME}`;
export const AUTHENTICATED_URL =
  process.env.AUTHENTICATED_DATABASE_URL ??
  `postgres://authenticated:authenticated_local_dev@localhost:5432/${DB_NAME}`;

/** A superuser connection that bypasses RLS - for seeding and cleanup only, never for assertions. */
export async function migratorClient(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: MIGRATOR_URL });
  await client.connect();
  return client;
}

/**
 * A connection as the `authenticated` role, "logged in" as the given app user via the same
 * request.jwt.claim.sub GUC PostgREST sets on real Supabase (see
 * tests/rls/fixtures/local_auth_shim.sql). Pass null to simulate an unauthenticated request.
 */
export async function asUser(userId: string | null): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: AUTHENTICATED_URL });
  await client.connect();
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  return client;
}

export async function rowCount(client: pg.Client, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await client.query(sql, params);
  return rows.length;
}
