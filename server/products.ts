import { and, desc, eq, ne } from 'drizzle-orm';
import type { License, ProductRecord, ProductSummary, ProductType } from '../shared/types.js';
import { emptyLicense } from '../shared/types.js';
import { ingestPdf } from './agents/ingest/index.js';
import { getDb } from './db/index.js';
import { authors, products, publishers } from './db/schema.js';
import { enqueue, registerHandler } from './jobs.js';
import { EMPIRE_MAKER } from './publisher.js';
import { renderProduct } from './render/index.js';
import { themeFor } from './render/theme.js';
import { storage } from './storage.js';
import { newId } from './util/ids.js';

type Row = typeof products.$inferSelect;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

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
  if (r.document && (body.title !== undefined || body.subtitle !== undefined)) {
    const doc = structuredClone(r.document);
    if (body.title?.trim()) {
      doc.title = body.title.trim();
      values.title = doc.title;
    }
    if (body.subtitle !== undefined) doc.subtitle = body.subtitle?.trim() || null;
    values.document = doc;
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
  if ((r.license ?? emptyLicense()).status !== 'confirmed') {
    throw new HttpError(409, 'Confirm the PLR rights for this source before it moves past ingest.');
  }
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
  const r = await row(job.productId);
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
      status: 'ingested',
    });
  } catch (e) {
    await patch(r.id, { status: 'failed' });
    throw e;
  }
});

registerHandler('render', async (job, progress) => {
  const r = await row(job.productId);
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
        doc: r.document!,
        brand: pub?.brand ?? EMPIRE_MAKER.brand,
        authorName: author?.penName ?? null,
        authorShortBio: author?.shortBio ?? null,
        catalog,
      },
      (pct, msg) => void progress(pct, msg),
    );
    const key = `renders/${r.id}.pdf`;
    await storage.put(key, out.pdf);
    await patch(r.id, { renderFileKey: key, status: 'rendered' });
  } catch (e) {
    await patch(r.id, { status: r.document ? 'ingested' : 'failed' });
    throw e;
  }
});
