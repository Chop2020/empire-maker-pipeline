// Clean-up step (Analyst, part 1): duplicates out, clearance risks found and fixed through the Writer.
import { eq } from 'drizzle-orm';
import type { ClearanceReport, Exclusion, ProductAnalysis, WriterSettings } from '../shared/types.js';
import { clearance } from './agents/analyst/clearance.js';
import { findDuplicates } from './agents/analyst/duplicates.js';
import { beefScope } from './agents/writer/scope.js';
import { getDb } from './db/index.js';
import { products } from './db/schema.js';
import { listPersonas } from './personas.js';
import { estimateWrite, requestWrite } from './products.js';
import { HttpError } from './util/http.js';

type Row = typeof products.$inferSelect;

async function row(id: string): Promise<Row> {
  const db = await getDb();
  const [r] = await db.select().from(products).where(eq(products.id, id));
  if (!r) throw new HttpError(404, 'Product not found');
  return r;
}

async function save(id: string, analysis: ProductAnalysis) {
  const db = await getDb();
  await db.update(products).set({ analysis, updatedAt: new Date() }).where(eq(products.id, id));
}

function analyse(r: Row): ProductAnalysis {
  if (!r.document) throw new HttpError(409, 'Ingest has not finished for this product.');
  const prev = r.analysis;
  const restored = prev?.restored ?? [];
  const dup = findDuplicates(r.document);
  const excluded: Record<string, Exclusion> = {};
  for (const [k, v] of Object.entries(dup.excluded)) if (!restored.includes(k)) excluded[k] = v;
  for (const [k, v] of Object.entries(prev?.excluded ?? {})) if (v.reason === 'user') excluded[k] = v;
  return { ranAt: new Date().toISOString(), groups: dup.groups, excluded, restored };
}

export async function runCleanup(id: string) {
  const r = await row(id);
  await save(id, analyse(r));
  return getCleanup(id);
}

/** Writer settings for a fix run: the last run's settings, else sensible defaults. */
async function fixSettings(r: Row): Promise<Partial<WriterSettings>> {
  const last = r.writerReport?.settings;
  if (last) return { personaId: last.personaId, convenience: last.convenience, scope: last.scope, minTransformation: last.minTransformation };
  const personas = await listPersonas();
  return { personaId: personas[0]?.id, convenience: 'upgrade', scope: 'all', minTransformation: 0.85 };
}

export async function getCleanup(id: string) {
  let r = await row(id);
  if (!r.document) throw new HttpError(409, 'Ingest has not finished for this product.');
  if (!r.analysis) {
    await save(id, analyse(r));
    r = await row(id);
  }
  const analysis = r.analysis!;
  const basis = r.draft ? 'draft' : 'source';
  const doc = r.draft ?? r.document!;
  const settings = await fixSettings(r);

  // Out-of-scope recipes (e.g. not beef) are cut by the Writer, not cleared — keep them out of the risk list.
  const outOfScope = new Set<string>();
  if (settings.scope === 'beef') {
    for (const s of doc.deliverables.flatMap((d) => d.sections)) {
      const b = s.blocks.find((x) => x.type === 'recipe');
      if (b?.type === 'recipe' && !beefScope(b).keep) outOfScope.add(s.id);
    }
  }
  const excluded = new Set([...Object.keys(analysis.excluded), ...outOfScope]);
  const report: ClearanceReport = clearance(doc, basis, r.writerReport ?? null, excluded);

  // A fix run rewrites every section with a problem (locked sections are left alone), and lets the Writer cut out-of-scope ones.
  const fixIds = [...new Set([...report.items.map((i) => i.sectionId), ...[...outOfScope].filter((sid) => !analysis.excluded[sid] && doc.deliverables.some((d) => d.sections.some((s) => s.id === sid)))])];
  let fix: { sections: number; usd: number | null; personaId: string | null } = { sections: fixIds.length, usd: null, personaId: settings.personaId ?? null };
  if (fixIds.length && settings.personaId) {
    try {
      const e = await estimateWrite(id, { ...settings, sectionIds: fixIds });
      fix = { ...fix, usd: e.usd };
    } catch {
      /* estimate is optional */
    }
  }
  return { analysis, clearance: report, outOfScope: outOfScope.size, fix };
}

export async function setExcluded(id: string, sectionId: string, exclude: boolean) {
  const r = await row(id);
  const a = r.analysis ?? analyse(r);
  const next: ProductAnalysis = { ...a, excluded: { ...a.excluded }, restored: [...a.restored] };
  if (exclude) {
    next.excluded[sectionId] = { reason: 'user', note: 'Removed by you' };
    next.restored = next.restored.filter((x) => x !== sectionId);
  } else {
    const was = next.excluded[sectionId];
    delete next.excluded[sectionId];
    if (was?.reason === 'duplicate') next.restored.push(sectionId);
  }
  await save(id, next);
  return getCleanup(id);
}

export async function fixClearance(id: string) {
  const r = await row(id);
  const c = await getCleanup(id);
  if (!c.fix.sections) throw new HttpError(409, 'Nothing to fix.');
  const settings = await fixSettings(r);
  if (!settings.personaId) throw new HttpError(409, 'Create a persona first.');
  const ids = [...new Set([...c.clearance.items.map((i) => i.sectionId)])];
  const doc = r.draft ?? r.document!;
  // include out-of-scope sections so the Writer cuts them from the draft
  if (settings.scope === 'beef') {
    for (const s of doc.deliverables.flatMap((d) => d.sections)) {
      const b = s.blocks.find((x) => x.type === 'recipe');
      if (b?.type === 'recipe' && !beefScope(b).keep && !c.analysis.excluded[s.id]) ids.push(s.id);
    }
  }
  return requestWrite(id, { ...settings, sectionIds: [...new Set(ids)] });
}
