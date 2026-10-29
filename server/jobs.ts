// In-process job runner with two lanes, so a long Writer run never blocks ingest or render.
// Job state lives in the DB so the UI can poll it; jobs left "running" by a restart are marked failed on boot.
import { desc, eq, inArray } from 'drizzle-orm';
import type { JobRecord } from '../shared/types.js';
import { getDb } from './db/index.js';
import { jobs } from './db/schema.js';
import { newId } from './util/ids.js';

export type JobProgress = (pct: number, message: string) => Promise<void>;
type Handler = (job: JobRecord & { payload: Record<string, unknown> }, progress: JobProgress) => Promise<unknown>;

const handlers = new Map<JobRecord['kind'], Handler>();
const LANE: Record<JobRecord['kind'], 'fast' | 'ai'> = { ingest: 'fast', render: 'fast', write: 'ai', persona: 'ai', images: 'ai' };
const queues: Record<'fast' | 'ai', string[]> = { fast: [], ai: [] };
const running: Record<'fast' | 'ai', boolean> = { fast: false, ai: false };
const cancelled = new Set<string>();

export function registerHandler(kind: JobRecord['kind'], h: Handler) {
  handlers.set(kind, h);
}

const toRecord = (r: typeof jobs.$inferSelect): JobRecord => ({
  id: r.id,
  productId: r.productId,
  kind: r.kind as JobRecord['kind'],
  status: r.status as JobRecord['status'],
  progress: r.progress,
  message: r.message,
  error: r.error,
  result: r.result ?? undefined,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export async function enqueue(productId: string | null, kind: JobRecord['kind'], payload: Record<string, unknown> = {}): Promise<JobRecord> {
  const db = await getDb();
  const id = newId('job');
  const [row] = await db.insert(jobs).values({ id, productId, kind, status: 'queued', message: 'Queued', payload }).returning();
  const lane = LANE[kind];
  queues[lane].push(id);
  void pump(lane);
  return toRecord(row);
}

export async function getJob(id: string): Promise<JobRecord | null> {
  const db = await getDb();
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  return row ? toRecord(row) : null;
}

export async function jobsForProduct(productId: string): Promise<JobRecord[]> {
  const db = await getDb();
  const rows = await db.select().from(jobs).where(eq(jobs.productId, productId)).orderBy(desc(jobs.createdAt)).limit(20);
  return rows.map(toRecord);
}

/** Ask a running job to stop at its next checkpoint (the Writer checks between sections). */
export function cancelJob(id: string) {
  cancelled.add(id);
}
export const isCancelled = (id: string) => cancelled.has(id);

export async function recoverJobs() {
  const db = await getDb();
  await db
    .update(jobs)
    .set({ status: 'failed', error: 'Server restarted while this job was running — run it again.', updatedAt: new Date() })
    .where(inArray(jobs.status, ['queued', 'running']));
}

async function pump(lane: 'fast' | 'ai') {
  if (running[lane]) return;
  running[lane] = true;
  try {
    while (queues[lane].length) {
      const id = queues[lane].shift()!;
      try {
        await runOne(id);
      } catch (e) {
        console.error(`[job ${id}] runner error:`, e); // never let a job take the server down
      }
    }
  } finally {
    running[lane] = false;
  }
}

async function runOne(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!row) return;
  const job = { ...toRecord(row), payload: row.payload ?? {} };
  const handler = handlers.get(job.kind);
  if (!handler) return;
  await db.update(jobs).set({ status: 'running', updatedAt: new Date() }).where(eq(jobs.id, id));
  let lastWrite = 0;
  const progress: JobProgress = async (pct, message) => {
    const now = Date.now();
    if (now - lastWrite < 400 && pct < 100) return; // throttle DB writes
    lastWrite = now;
    await db.update(jobs).set({ progress: Math.round(pct), message, updatedAt: new Date() }).where(eq(jobs.id, id));
  };
  try {
    const result = await handler(job, progress);
    await db
      .update(jobs)
      .set({ status: 'done', progress: 100, result: result ?? null, updatedAt: new Date() })
      .where(eq(jobs.id, id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[job ${id}] ${job.kind} failed:`, e);
    await db.update(jobs).set({ status: 'failed', error: msg.slice(0, 2000), updatedAt: new Date() }).where(eq(jobs.id, id));
  } finally {
    cancelled.delete(id);
  }
}
