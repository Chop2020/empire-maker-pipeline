import { and, desc, eq, ne } from 'drizzle-orm';
import type { ConvenienceMode, License, ProductRecord, ProductSummary, ProductType, WriterSettings } from '../shared/types.js';
import { emptyLicense } from '../shared/types.js';
import { ingestPdf } from './agents/ingest/index.js';
import { getDb } from './db/index.js';
import { authors, products, publishers } from './db/schema.js';
import { estimateRun, writeProduct } from './agents/writer/index.js';
import { config } from './config.js';
import { enqueue, isCancelled, registerHandler } from './jobs.js';
import { anthropicLlm } from './llm.js';
import { imagesForRender } from './images.js';
import { bookDoc, withoutExcluded } from './book.js';
import { sameNameNotes } from './agents/analyst/duplicates.js';
import { clearance, clearanceNotes } from './agents/analyst/clearance.js';
import { getPersona } from './personas.js';
import { EMPIRE_MAKER } from './publisher.js';
import { renderProduct } from './render/index.js';
import { themeFor } from './render/theme.js';
import { storage } from './storage.js';
import { newId } from './util/ids.js';
import { HttpError } from './util/http.js';

type Row = typeof products.$inferSelect;

export { HttpError };

const summary = (r: Row): ProductSummary => ({
  id: r.id,
  title: r.title,
  productType: r.productType as ProductType,
  status: r.status as ProductSummary['status'],
  sourceFileName: r.sourceFileName,
  licenseStatus: (r.license ?? emptyLicense()).status,
  renderFileKey: r.renderFileKey,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

async function authorFor(r: Row) {
  if (!r.authorId) return null;
  const db = await getDb();
  const [a] = await db.select().from(authors).where(eq(authors.id, r.authorId));
  return a ?? null;
}

async function record(r: Row): Promise<ProductRecord> {
  const a = await authorFor(r);
  return {
    ...summary(r),
    document: r.document ?? null,
    license: r.license ?? emptyLicense(),
    ingestReport: r.ingestReport ?? null,
    draft: r.draft ?? null,
    writerReport: r.writerReport ?? null,
    images: r.images ?? null,
    analysis: r.analysis ?? null,
    authorPenName: a?.penName ?? null,
    authorShortBio: a?.shortBio ?? null,
  };
}

async function row(id: string): Promise<Row> {
  const db = await getDb();
  const [r] = await db.select().from(products).where(eq(products.id, id));
  if (!r) throw new HttpError(404, 'Product not found');
  return r;
}

async function patch(id: string, values: Partial<typeof products.$inferInsert>) {
  const db = await getDb();
  await db.update(products).set({ ...values, updatedAt: new Date() }).where(eq(products.id, id));
}

export async function listProducts(): Promise<ProductSummary[]> {
  const db = await getDb();
  const rows = await db.select().from(products).orderBy(desc(products.createdAt));
  return rows.map(summary);
}

export async function getProduct(id: string) {
  return record(await row(id));
}

export async function createFromUpload(fileName: string, data: Buffer) {
  if (!/\.pdf$/i.test(fileName) && data.subarray(0, 5).toString() !== '%PDF-') {
    throw new HttpError(400, 'Only PDF files are supported right now.');
  }
  const db = await getDb();
  const id = newId('prd');
  const key = `sources/${id}.pdf`;
  await storage.put(key, data);
  await db.insert(products).values({
    id,
    publisherId: EMPIRE_MAKER.id,
    title: fileName.replace(/\.pdf$/i, ''),
    status: 'ingesting',
    sourceFileName: fileName,
    sourceFileKey: key,
    license: emptyLicense(),
  });
  const job = await enqueue(id, 'ingest');
  return { product: await getProduct(id), job };
}

export async function reingest(id: string) {
  await row(id);
  await patch(id, { status: 'ingesting' });
  return enqueue(id, 'ingest');
}

export async function updateMeta(id: string, body: { title?: string; subtitle?: string | null; authorPenName?: string | null; authorShortBio?: string | null }) {
  const r = await row(id);
  const db = await getDb();
  const values: Partial<typeof products.$inferInsert> = {};
  const base = r.draft ?? r.document;
  if (base && (body.title !== undefined || body.subtitle !== undefined)) {
    const doc = structuredClone(base);
    if (body.title?.trim()) {
      doc.title = body.title.trim();
      values.title = doc.title;
    }
    if (body.subtitle !== undefined) doc.subtitle = body.subtitle?.trim() || null;
    if (r.draft) values.draft = doc;
    else values.document = doc;
  }
  if (body.authorPenName !== undefined) {
    const name = body.authorPenName?.trim();
    if (!name) values.authorId = null;
    else {
      const [existing] = await db
        .select()
        .from(authors)
        .where(and(eq(authors.publisherId, EMPIRE_MAKER.id), eq(authors.penName, name)));
      if (existing) {
        values.authorId = existing.id;
        if (body.authorShortBio !== undefined) await db.update(authors).set({ shortBio: body.authorShortBio }).where(eq(authors.id, existing.id));
      } else {
        const aid = newId('aut');
        await db.insert(authors).values({ id: aid, publisherId: EMPIRE_MAKER.id, penName: name, shortBio: body.authorShortBio ?? null });
        values.authorId = aid;
      }
    }
  }
  await patch(id, values);
  return getProduct(id);
}

export async function updateLicense(id: string, body: Partial<License> & { confirm?: boolean }) {
  const r = await row(id);
  const lic: License = { ...(r.license ?? emptyLicense()) };
  for (const k of ['canEdit', 'canRebrand', 'canClaimAuthorship', 'canSellAsFinishedProduct'] as const) {
    if (typeof body[k] === 'boolean') lic[k] = body[k];
  }
  if (Array.isArray(body.platformRestrictions)) lic.platformRestrictions = body.platformRestrictions.map(String).filter(Boolean);
  if (typeof body.rawTerms === 'string') lic.rawTerms = body.rawTerms;
  if (body.confirm) {
    const missing = (['canEdit', 'canRebrand', 'canClaimAuthorship', 'canSellAsFinishedProduct'] as const).filter((k) => lic[k] !== true);
    if (missing.length) {
      throw new HttpError(
        409,
        'These rights are required to rewrite and sell this as an Empire Maker product: edit, rebrand, claim authorship, sell as a finished product. Without them, use this source only as research.',
      );
    }
    lic.status = 'confirmed';
    lic.confirmedAt = new Date().toISOString();
  } else if (lic.status === 'confirmed') {
    lic.status = lic.rawTerms ? 'detected' : 'missing';
    lic.confirmedAt = null;
  }
  await patch(id, { license: lic });
  return getProduct(id);
}

export async function requestRender(id: string) {
  const r = await row(id);
  if (!r.document) throw new HttpError(409, 'Ingest has not finished for this product.');
  return enqueue(id, 'render');
}

export async function readRendered(id: string) {
  const r = await row(id);
  if (!r.renderFileKey) throw new HttpError(404, 'This product has not been rendered yet.');
  return { data: await storage.get(r.renderFileKey), fileName: `${slug(r.title)}.pdf` };
}

export async function readSource(id: string) {
  const r = await row(id);
  return { data: await storage.get(r.sourceFileKey), fileName: r.sourceFileName };
}

export async function deleteProduct(id: string) {
  await row(id);
  const db = await getDb();
  await db.delete(products).where(eq(products.id, id));
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'book';

// ---------- job handlers ----------

registerHandler('ingest', async (job, progress) => {
  const r = await row(job.productId!);
  try {
    const data = await storage.get(r.sourceFileKey);
    const res = await ingestPdf(new Uint8Array(data), r.sourceFileName, (pct, msg) => void progress(pct, msg));
    // Keep a confirmed license across re-ingests; otherwise take what ingest found.
    const prev = r.license ?? emptyLicense();
    const license = prev.status === 'confirmed' ? prev : { ...res.license };
    await patch(r.id, {
      title: res.document.title,
      productType: res.document.productType,
      document: res.document,
      ingestReport: res.report,
      license,
      status: r.draft ? 'written' : 'ingested',
    });
  } catch (e) {
    await patch(r.id, { status: 'failed' });
    throw e;
  }
});

registerHandler('render', async (job, progress) => {
  const r = await row(job.productId!);
  const db = await getDb();
  await patch(r.id, { status: 'rendering' });
  try {
    const [pub] = await db.select().from(publishers).where(eq(publishers.id, r.publisherId));
    const author = await authorFor(r);
    // "More from Empire Maker": other finished titles, same type first.
    const others = await db
      .select()
      .from(products)
      .where(and(eq(products.status, 'rendered'), ne(products.id, r.id)))
      .orderBy(desc(products.updatedAt))
      .limit(12);
    others.sort((a, b) => Number(b.productType === r.productType) - Number(a.productType === r.productType));
    const catalog = others.map((o) => {
      const t = themeFor(o.productType as ProductType);
      return { title: o.title, coverBg: t.colors.coverBg, coverAccent: t.colors.coverAccent };
    });
    const out = await renderProduct(
      {
        productId: r.id,
        doc: bookDoc(r)!,
        brand: pub?.brand ?? EMPIRE_MAKER.brand,
        authorName: author?.penName ?? null,
        authorShortBio: author?.shortBio ?? null,
        catalog,
        images: await imagesForRender(r),
      },
      (pct, msg) => void progress(pct, msg),
    );
    const key = `renders/${r.id}.pdf`;
    await storage.put(key, out.pdf);
    await patch(r.id, { renderFileKey: key, status: 'rendered' });
  } catch (e) {
    await patch(r.id, { status: r.draft ? 'written' : r.document ? 'ingested' : 'failed' });
    throw e;
  }
});

// ---------- Writer (Agent 2) ----------

function settingsFrom(body: Partial<WriterSettings>): WriterSettings {
  if (!body.personaId) throw new HttpError(400, 'Pick a persona.');
  const convenience: ConvenienceMode = body.convenience === 'keep' || body.convenience === 'cut' ? body.convenience : 'upgrade';
  return {
    personaId: body.personaId,
    convenience,
    scope: body.scope === 'beef' ? 'beef' : 'all',
    sectionIds: Array.isArray(body.sectionIds) && body.sectionIds.length ? body.sectionIds.map(String) : undefined,
    limit: body.limit && Number(body.limit) > 0 ? Math.floor(Number(body.limit)) : undefined,
    minTransformation: Math.min(0.98, Math.max(0.5, Number(body.minTransformation ?? 0.85))),
  };
}

export async function estimateWrite(id: string, body: Partial<WriterSettings>) {
  const r = await row(id);
  if (!r.document) throw new HttpError(409, 'Ingest has not finished for this product.');
  const settings = settingsFrom(body);
  const persona = await getPersona(settings.personaId);
  const [pub] = await (await getDb()).select().from(publishers).where(eq(publishers.id, r.publisherId));
  const e = estimateRun(withoutExcluded(r.document, r.analysis), settings, persona, pub?.brand ?? EMPIRE_MAKER.brand);
  const usd =
    config.priceInPerMTok !== null && config.priceOutPerMTok !== null
      ? (e.inputTokens / 1e6) * config.priceInPerMTok + (e.outputTokens / 1e6) * config.priceOutPerMTok
      : null;
  return { ...e, usd, model: config.writerModel, aiReady: Boolean(config.anthropicApiKey) };
}

export async function requestWrite(id: string, body: Partial<WriterSettings>) {
  const r = await row(id);
  if (!r.document) throw new HttpError(409, 'Ingest has not finished for this product.');
  const settings = settingsFrom(body);
  await getPersona(settings.personaId);
  if (!config.anthropicApiKey) throw new HttpError(409, 'ANTHROPIC_API_KEY is not set — add it in Replit Secrets to use the AI agents.');
  return enqueue(id, 'write', settings as unknown as Record<string, unknown>);
}

export async function discardDraft(id: string) {
  const r = await row(id);
  await patch(r.id, { draft: null, writerReport: null, status: r.document ? 'ingested' : r.status, title: r.document?.title ?? r.title });
  return getProduct(id);
}

export async function setSectionLock(id: string, sectionId: string, locked: boolean) {
  const r = await row(id);
  if (!r.draft) throw new HttpError(409, 'No draft yet.');
  const draft = structuredClone(r.draft);
  const s = draft.deliverables.flatMap((d) => d.sections).find((x) => x.id === sectionId);
  if (!s) throw new HttpError(404, 'Section not found');
  s.lockedByUser = locked;
  await patch(r.id, { draft });
  return getProduct(id);
}

registerHandler('write', async (job, progress) => {
  const r = await row(job.productId!);
  const settings = job.payload as unknown as WriterSettings;
  const db = await getDb();
  await patch(r.id, { status: 'writing' });
  try {
    const persona = await getPersona(settings.personaId);
    const [pub] = await db.select().from(publishers).where(eq(publishers.id, r.publisherId));
    // Clean-up: duplicates are out, same-name recipes get distinct titles, clearance risks get fixed in the rewrite.
    const source = withoutExcluded(r.document!, r.analysis);
    const notes: Record<string, string> = {};
    const add = (m: Record<string, string>) => Object.entries(m).forEach(([k, v]) => (notes[k] = notes[k] ? `${notes[k]} ${v}` : v));
    if (r.analysis) add(sameNameNotes(source, r.analysis.groups));
    add(clearanceNotes(clearance(source, 'source', null, new Set())));
    const out = await writeProduct({
      notes,
      llm: anthropicLlm(),
      persona,
      brand: pub?.brand ?? EMPIRE_MAKER.brand,
      source,
      existingDraft: r.draft ? withoutExcluded(r.draft, r.analysis) : null,
      settings,
      progress: (pct, msg) => progress(pct, msg),
      cancelled: () => isCancelled(job.id),
      concurrency: config.writerConcurrency,
    });
    // Merge this run's section results into the cumulative report.
    const prev = r.writerReport?.sections ?? [];
    const merged = [...prev.filter((p) => !out.report.sections.some((n) => n.sectionId === p.sectionId)), ...out.report.sections];
    const scored = merged.filter((m) => m.transformation !== null);
    const report = {
      ...out.report,
      sections: merged,
      avgTransformation: scored.length ? scored.reduce((n, m) => n + (m.transformation ?? 0), 0) / scored.length : null,
    };
    await patch(r.id, { draft: out.draft, writerReport: report, title: out.draft.title, status: 'written' });
    return { written: out.report.sections.filter((s) => s.status === 'written').length, flagged: out.report.sections.filter((s) => s.status === 'flagged').length, usage: out.report.usage };
  } catch (e) {
    await patch(r.id, { status: r.draft ? 'written' : 'ingested' });
    throw e;
  }
});
