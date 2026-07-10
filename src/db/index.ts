import { drizzle as drizzleNode, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import { Pool as NodePool } from 'pg';
import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless';
import * as domain from './schema';
import * as auth from './auth-schema';

export const schema = { ...domain, ...auth };

const url = process.env.DATABASE_URL ?? 'postgres://cpms:cpms@localhost:5432/cpms';
const useNeon = process.env.DB_DRIVER === 'neon' || /neon\.tech/.test(url);

function createDb() {
  if (useNeon) {
    if (typeof WebSocket !== 'undefined') {
      neonConfig.webSocketConstructor = WebSocket;
    }
    const pool = new NeonPool({ connectionString: url });
    return drizzleNeon(pool, { schema });
  }
  const pool = new NodePool({ connectionString: url });
  return drizzleNode(pool, { schema });
}

declare global {
  var __cpmsDb: ReturnType<typeof createDb> | undefined;
}

// Reuse the pool across hot reloads in dev; create once per instance in prod.
export const db: NodePgDatabase<typeof schema> = (globalThis.__cpmsDb ??=
  createDb()) as NodePgDatabase<typeof schema>;
