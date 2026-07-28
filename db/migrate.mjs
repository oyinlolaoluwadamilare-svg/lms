#!/usr/bin/env node
// Sequential SQL migration runner. See db/migrations/README.md.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "migrations");
const direction = process.argv[2];

if (direction !== "up" && direction !== "down") {
  console.error("Usage: node db/migrate.mjs <up|down>");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

function listMigrations() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".up.sql"));
  const versions = files.map((f) => f.replace(/\.up\.sql$/, "")).sort();
  return versions;
}

async function ensureTrackingTable(client) {
  await client.query(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function appliedVersions(client) {
  const { rows } = await client.query("select version from schema_migrations order by version");
  return new Set(rows.map((r) => r.version));
}

async function up(client) {
  const versions = listMigrations();
  const applied = await appliedVersions(client);
  const pending = versions.filter((v) => !applied.has(v));

  if (pending.length === 0) {
    console.log("Nothing to apply.");
    return;
  }

  for (const version of pending) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, `${version}.up.sql`), "utf8");
    console.log(`Applying ${version}...`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into schema_migrations (version) values ($1)", [version]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw new Error(`Migration ${version} failed: ${err.message}`, { cause: err });
    }
  }
  console.log(`Applied ${pending.length} migration(s).`);
}

async function down(client) {
  const applied = [...(await appliedVersions(client))].sort();
  const last = applied.at(-1);
  if (!last) {
    console.log("Nothing to roll back.");
    return;
  }
  const sql = readFileSync(path.join(MIGRATIONS_DIR, `${last}.down.sql`), "utf8");
  console.log(`Rolling back ${last}...`);
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query("delete from schema_migrations where version = $1", [last]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw new Error(`Rollback of ${last} failed: ${err.message}`, { cause: err });
  }
  console.log(`Rolled back ${last}.`);
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await ensureTrackingTable(client);
  if (direction === "up") await up(client);
  else await down(client);
} finally {
  await client.end();
}
