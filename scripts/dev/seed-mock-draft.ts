// Dev only: write a mock draft for a product into the local DB (no API key needed), to try the review UI.
// Usage: tsx scripts/dev/seed-mock-draft.ts <productId> [limit]
import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import type { Persona } from '../../shared/types.js';
import { writeProduct } from '../../server/agents/writer/index.js';
import { getDb } from '../../server/db/index.js';
import { products } from '../../server/db/schema.js';
import { EMPIRE_MAKER } from '../../server/publisher.js';
import { mockLlm } from './mock-llm.js';

const [id, lim] = process.argv.slice(2);
const db = await getDb();
const [r] = await db.select().from(products).where(eq(products.id, id));
const persona = JSON.parse(fs.readFileSync('personas/flavor-hunter.json', 'utf8')) as Persona;
const ex = JSON.parse(fs.readFileSync('personas/flavor-hunter.examples.json', 'utf8')).examples;
persona.examples = ex;
const settings = { personaId: persona.id, convenience: 'upgrade' as const, scope: 'beef' as const, minTransformation: 0.85, limit: Number(lim ?? 12) };
const out = await writeProduct({ llm: mockLlm(ex), persona, brand: EMPIRE_MAKER.brand, source: r.document!, existingDraft: null, settings, progress: () => {} });
await db.update(products).set({ draft: out.draft, writerReport: out.report, title: out.draft.title, status: 'written' }).where(eq(products.id, id));
console.log('mock draft saved:', out.report.sections.map((s) => s.status).join(','));
process.exit(0);
