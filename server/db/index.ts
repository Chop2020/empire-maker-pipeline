// Postgres when DATABASE_URL is set (Replit's built-in Postgres), embedded PGlite otherwise.
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { config } from '../config.js';
import { DDL, publishers } from './schema.js';
import * as schema from './schema.js';
import { EMPIRE_MAKER } from '../publisher.js';

// Both drivers expose the same query-builder surface; type it once.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DB = PgDatabase<any, typeof schema>;

let db: DB | null = null;
let runRaw: ((sql: string) => Promise<unknown>) | null = null;

export async function getDb(): Promise<DB> {
  if (db) return db;
  if (config.databaseUrl) {
    const { default: pg } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5 });
    db = drizzle(pool, { schema }) as unknown as DB;
    runRaw = (q) => pool.query(q);
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const dir = path.join(config.dataDir, 'pglite');
    fs.mkdirSync(dir, { recursive: true });
    const client = new PGlite(dir);
    db = drizzle(client, { schema }) as unknown as DB;
    runRaw = (q) => client.exec(q);
  }
  await runRaw!(DDL);
  await seed(db);
  return db;
}

async function seed(d: DB) {
  const existing = await d.select().from(publishers).where(eq(publishers.id, EMPIRE_MAKER.id));
  if (!existing.length) {
    await d.insert(publishers).values({ id: EMPIRE_MAKER.id, name: EMPIRE_MAKER.brand.name, brand: EMPIRE_MAKER.brand });
  } else {
    // keep brand in sync with code (single source of truth while the brand is locked)
    await d.update(publishers).set({ brand: EMPIRE_MAKER.brand, name: EMPIRE_MAKER.brand.name }).where(eq(publishers.id, EMPIRE_MAKER.id));
  }
}
