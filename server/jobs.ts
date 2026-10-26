// In-process job runner. One user, one box: a simple serial queue is enough and survives nothing fancy.
// Job state lives in the DB so the UI can poll it; jobs left "running" by a restart are marked failed on boot.
import { desc, eq, inArray } from 'drizzle-orm';
import type { JobRecord } from '../shared/types.js';
import { getDb } from './db/index.js';
import { jobs } from './db/schema.js';
import { newId } from './util/ids.js';

type Handler = (job: JobRecord, progress: (pct: number, message: string) => Promise<void>) => Promise<void>;

const handlers = new Map<JobRecord['kind'], Handler>();
const queue: string[] = [];
let running = false;

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
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export async function enqueue(productId: string, kind: JobRecord['kind']): Promise<JobRecord> {
  const db = await getDb();
  const id = newId('job');
  const [row] = await db.insert(jobs).values({ id, productId, kind, status: 'queued', message: 'Queued' }).returning();
  queue.push(id);
  void pump();
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

export async function recoverJobs() {
  const db = await getDb();
  await db
    .update(jobs)
    .set({ status: 'failed', error: 'Server restarted while this job was running — run it again.', updatedAt: new Date() })
    .where(inArray(jobs.status, ['queued', 'running']));
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      await runOne(id);
    }
  } finally {
    running = false;
  }
}

async function runOne(id: string) {
  const db = await getDb();
  const job = await getJob(id);
  if (!job) return;
  const handler = handlers.get(job.kind);
  if (!handler) return;
  await db.update(jobs).set({ status: 'running', updatedAt: new Date() }).where(eq(jobs.id, id));
  let lastWrite = 0;
  const progress = async (pct: number, message: string) => {
    const now = Date.now();
    if (now - lastWrite < 400 && pct < 100) return; // throttle DB writes
    lastWrite = now;
    await db.update(jobs).set({ progress: pct, message, updatedAt: new Date() }).where(eq(jobs.id, id));
  };
  try {
    await handler(job, progress);
    await db.update(jobs).set({ status: 'done', progress: 100, updatedAt: new Date() }).where(eq(jobs.id, id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[job ${id}] ${job.kind} failed:`, e);
    await db.update(jobs).set({ status: 'failed', error: msg.slice(0, 2000), updatedAt: new Date() }).where(eq(jobs.id, id));
  }
}
