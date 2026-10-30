// Images for a product: style bible, generation jobs (Image Director → image model), review state, files.
import { eq } from 'drizzle-orm';
import type { ImageAsset, ImageRequest, ImageSlotKind, ProductDocument, ProductImages, ProductType, Section } from '../shared/types.js';
import { IMAGE_STYLE_PRESETS } from '../shared/types.js';
import { coverBrief, directShot, openerBrief, recipeBrief, withStyle, type ShotBrief } from './agents/images/director.js';
import { estimateUsd, imageProvider, imagesReady } from './agents/images/provider.js';
import { config } from './config.js';
import { getDb } from './db/index.js';
import { products } from './db/schema.js';
import { enqueue, isCancelled, registerHandler } from './jobs.js';
import { anthropicLlm } from './llm.js';
import { themeFor } from './render/theme.js';
import { storage } from './storage.js';
import { bookDoc } from './book.js';
import { HttpError } from './util/http.js';

type Row = typeof products.$inferSelect;

async function row(id: string): Promise<Row> {
  const db = await getDb();
  const [r] = await db.select().from(products).where(eq(products.id, id));
  if (!r) throw new HttpError(404, 'Product not found');
  return r;
}

export const defaultImages = (): ProductImages => {
  const preset = IMAGE_STYLE_PRESETS[0];
  return { style: { presetId: preset.id, text: preset.text }, items: {}, spentUsd: 0 };
};

export const imagesOf = (r: Row) => r.images ?? defaultImages();

// One writer at a time per product, so parallel image workers and UI clicks never overwrite each other.
const locks = new Map<string, Promise<unknown>>();
async function mutate(id: string, fn: (imgs: ProductImages, r: Row) => void | Promise<void>): Promise<ProductImages> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.then(async () => {
    const r = await row(id);
    const imgs = structuredClone(imagesOf(r));
    await fn(imgs, r);
    const db = await getDb();
    await db.update(products).set({ images: imgs, updatedAt: new Date() }).where(eq(products.id, id));
    return imgs;
  });
  locks.set(id, next.catch(() => undefined));
  return next;
}

// ---------- slot sizes ----------

const r32 = (n: number) => Math.max(256, Math.round(n / 32) * 32);

export function sizeFor(kind: ImageSlotKind, type: ProductType) {
  if (kind === 'hero') return { width: 1984, height: 1024 }; // ~2 MP, ~1.94:1 across the top of a recipe page
  const t = themeFor(type).trim;
  const ratio = t.w / t.h;
  const mp = 3.35e6; // full page: ~200+ dpi at 8x10, under FLUX's 4 MP cap
  const h = Math.sqrt(mp / ratio);
  return { width: r32(h * ratio), height: r32(h) };
}

// ---------- which slots a request covers ----------

interface Target {
  slot: string;
  kind: ImageSlotKind;
  brief: ShotBrief;
}

const contentSections = (doc: ProductDocument) => doc.deliverables.flatMap((d) => d.sections).filter((s) => s.kind !== 'front' && s.kind !== 'back');
const isRecipe = (s: Section) => s.kind === 'recipe' && s.blocks.some((b) => b.type === 'recipe');
const isOpener = (s: Section) => s.kind === 'part' || s.kind === 'chapter';

function targetFor(doc: ProductDocument, slot: string): Target | null {
  if (slot === 'cover') return { slot, kind: 'cover', brief: coverBrief(doc) };
  const all = contentSections(doc);
  const i = all.findIndex((s) => s.id === slot);
  if (i < 0) return null;
  const s = all[i];
  if (isRecipe(s)) return { slot, kind: 'hero', brief: recipeBrief(s) };
  const nextOpener = all.findIndex((x, j) => j > i && isOpener(x));
  return { slot, kind: 'opener', brief: openerBrief(s, all.slice(i + 1, nextOpener < 0 ? undefined : nextOpener)) };
}

function pickTargets(doc: ProductDocument, imgs: ProductImages, req: ImageRequest): Target[] {
  const has = (slot: string) => {
    const a = imgs.items[slot];
    return Boolean(a && a.webKey && a.status !== 'failed');
  };
  const all = contentSections(doc);
  const ids = (list: Section[]) => list.map((s) => targetFor(doc, s.id)).filter((t): t is Target => Boolean(t));
  switch (req.target) {
    case 'cover':
      return [targetFor(doc, 'cover')!];
    case 'slot': {
      const t = req.slot ? targetFor(doc, req.slot) : null;
      if (!t) throw new HttpError(404, 'That section is not in the current draft.');
      return [t];
    }
    case 'sample':
      return ids(all.filter((s) => isRecipe(s) && !has(s.id)).slice(0, Math.min(25, Math.max(1, req.limit ?? 5))));
    case 'recipes':
      return ids(all.filter((s) => isRecipe(s) && !has(s.id)));
    case 'openers':
      return ids(all.filter((s) => isOpener(s) && !has(s.id)));
  }
}

// ---------- API ----------

export async function imagePlan(id: string) {
  const r = await row(id);
  const doc = bookDoc(r);
  if (!doc) throw new HttpError(409, 'Ingest has not finished for this product.');
  const imgs = imagesOf(r);
  const all = contentSections(doc);
  const done = (list: Section[]) => list.filter((s) => imgs.items[s.id]?.webKey && imgs.items[s.id].status !== 'failed').length;
  const recipes = all.filter(isRecipe);
  const openers = all.filter(isOpener);
  const type = r.productType as ProductType;
  const hero = sizeFor('hero', type);
  const page = sizeFor('cover', type);
  return {
    ready: imagesReady(),
    provider: config.imageProvider,
    model: config.imageProvider === 'mock' ? 'mock' : config.imageModel,
    directorReady: Boolean(config.anthropicApiKey),
    recipes: { total: recipes.length, done: done(recipes) },
    openers: { total: openers.length, done: done(openers) },
    cover: Boolean(imgs.items.cover?.webKey),
    heroUsd: estimateUsd(hero.width, hero.height),
    pageUsd: estimateUsd(page.width, page.height),
    spentUsd: imgs.spentUsd,
    usingDraft: Boolean(r.draft),
  };
}

export async function requestImages(id: string, body: Partial<ImageRequest>) {
  const r = await row(id);
  const doc = bookDoc(r);
  if (!doc) throw new HttpError(409, 'Ingest has not finished for this product.');
  if (!imagesReady()) throw new HttpError(409, 'BFL_API_KEY is not set — add your Black Forest Labs API key in Replit Secrets, then restart the app.');
  const targets = ['cover', 'sample', 'recipes', 'openers', 'slot'];
  if (!body.target || !targets.includes(body.target)) throw new HttpError(400, 'Unknown image target.');
  const req: ImageRequest = {
    target: body.target,
    slot: body.slot ? String(body.slot) : undefined,
    limit: body.limit ? Number(body.limit) : undefined,
    prompt: typeof body.prompt === 'string' && body.prompt.trim() ? body.prompt.trim().slice(0, 4000) : undefined,
  };
  const picked = pickTargets(doc, imagesOf(r), req);
  if (!picked.length) throw new HttpError(409, 'Nothing to generate — every slot in that group already has an image.');
  return enqueue(id, 'images', req as unknown as Record<string, unknown>);
}

export async function setImageStyle(id: string, body: { presetId?: string; text?: string }) {
  await mutate(id, (imgs) => {
    const preset = IMAGE_STYLE_PRESETS.find((p) => p.id === body.presetId);
    if (preset && body.text === undefined) imgs.style = { presetId: preset.id, text: preset.text };
    else if (typeof body.text === 'string' && body.text.trim()) imgs.style = { presetId: body.presetId ?? 'custom', text: body.text.trim().slice(0, 3000) };
  });
}

export async function setImageApproved(id: string, slot: string, approved: boolean) {
  await mutate(id, (imgs) => {
    const a = imgs.items[slot];
    if (!a || !a.webKey) throw new HttpError(404, 'No image in that slot.');
    a.status = approved ? 'approved' : 'ready';
  });
}

export async function removeImage(id: string, slot: string) {
  await mutate(id, (imgs) => {
    delete imgs.items[slot];
  });
}

export async function readImage(id: string, slot: string, full: boolean) {
  const r = await row(id);
  const a = imagesOf(r).items[slot];
  const key = full ? a?.key : a?.webKey;
  if (!key) throw new HttpError(404, 'No image in that slot.');
  return storage.get(key);
}

/** Approved/ready images for the renderer: slot → compressed JPEG. */
export async function imagesForRender(r: Row): Promise<Record<string, { data: Buffer; alt: string }>> {
  const out: Record<string, { data: Buffer; alt: string }> = {};
  for (const [slot, a] of Object.entries(imagesOf(r).items)) {
    if (!a.webKey || a.status === 'failed') continue;
    try {
      out[slot] = { data: await storage.get(a.webKey), alt: a.alt };
    } catch {
      /* missing file: render without it */
    }
  }
  return out;
}

// ---------- job ----------

const safe = (s: string) => s.replace(/[^a-z0-9_-]/gi, '_');

/** The PDF copy: resized for 200 dpi at the slot's printed size, high-quality JPEG. The original stays for print editions. */
async function webCopy(data: Buffer, kind: ImageSlotKind) {
  // Loaded lazily: if the native module ever fails to install, the rest of the app still runs.
  const { default: sharp } = await import('sharp');
  return sharp(data)
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: kind === 'hero' ? 80 : 82, mozjpeg: true, chromaSubsampling: '4:2:0' })
    .toBuffer();
}

async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

registerHandler('images', async (job, progress) => {
  const id = job.productId!;
  const req = job.payload as unknown as ImageRequest;
  const r = await row(id);
  const doc = bookDoc(r);
  if (!doc) throw new Error('No document to illustrate.');
  const imgs = imagesOf(r);
  const targets = pickTargets(doc, imgs, req);
  const type = r.productType as ProductType;
  const provider = imageProvider();
  const llm = config.anthropicApiKey ? anthropicLlm() : null;
  const style = imgs.style.text;

  let done = 0;
  let ok = 0;
  let spent = 0;
  const errors: string[] = [];
  await progress(2, `Generating ${targets.length} image${targets.length === 1 ? '' : 's'} with ${provider.model}`);

  await pool(targets, config.imageConcurrency, async (t) => {
    if (isCancelled(job.id)) return;
    const size = sizeFor(t.kind, type);
    try {
      const shot =
        req.target === 'slot' && req.prompt
          ? { prompt: req.prompt.replace(style.trim(), '').trim(), alt: imgs.items[t.slot]?.alt ?? t.brief.title }
          : await directShot(llm, config.imageDirectorModel, style, t.brief);
      const prompt = withStyle(shot.prompt, style);
      const gen = await provider.generate({ prompt, ...size, label: t.brief.title });
      const web = await webCopy(gen.data, t.kind);
      await mutate(id, async (live) => {
        const v = (live.items[t.slot]?.version ?? 0) + 1;
        const base = `images/${safe(id)}/${safe(t.slot)}-v${v}`;
        await storage.put(`${base}.jpg`, gen.data);
        await storage.put(`${base}.web.jpg`, web);
        const asset: ImageAsset = {
          slot: t.slot,
          kind: t.kind,
          title: t.brief.title,
          status: 'ready',
          prompt: shot.prompt, // subject only; the style bible is appended at generation time
          alt: shot.alt,
          key: `${base}.jpg`,
          webKey: `${base}.web.jpg`,
          width: size.width,
          height: size.height,
          seed: gen.seed,
          model: gen.model,
          costUsd: gen.costUsd,
          version: v,
          createdAt: new Date().toISOString(),
        };
        live.items[t.slot] = asset;
        live.spentUsd = Math.round(((live.spentUsd ?? 0) + (gen.costUsd ?? estimateUsd(size.width, size.height))) * 1000) / 1000;
      });
      spent += gen.costUsd ?? estimateUsd(size.width, size.height);
      ok++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${t.brief.title}: ${msg}`);
      // Keep an existing good image if a redo fails; otherwise record the failure so it shows in the gallery.
      await mutate(id, (live) => {
        const prev = live.items[t.slot];
        if (prev?.webKey) prev.error = msg;
        else
          live.items[t.slot] = {
            slot: t.slot,
            kind: t.kind,
            title: t.brief.title,
            status: 'failed',
            prompt: '',
            alt: '',
            key: null,
            webKey: null,
            width: size.width,
            height: size.height,
            seed: null,
            model: provider.model,
            costUsd: null,
            error: msg,
            version: prev?.version ?? 0,
            createdAt: new Date().toISOString(),
          };
      });
    } finally {
      done++;
      await progress(2 + (96 * done) / targets.length, `${done}/${targets.length} · ${t.brief.title}`);
    }
  });

  await progress(100, `${ok} image${ok === 1 ? "" : "s"} generated${errors.length ? `, ${errors.length} failed` : ""}`);
  if (ok === 0 && errors.length) throw new Error(errors[0]);
  return { generated: ok, failed: errors.length, spentUsd: Math.round(spent * 1000) / 1000, errors: errors.slice(0, 5) };
});
