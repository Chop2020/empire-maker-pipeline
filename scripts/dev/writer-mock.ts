// Exercise the Writer pipeline end to end without an API key: a fake LLM that
// (1) copies the source on the first attempt to prove the copy check forces a retry,
// (2) returns the approved Flavor Hunter examples when it sees those recipes,
// (3) returns obviously-synthetic text otherwise. Then renders the draft.
// Usage: tsx scripts/dev/writer-mock.ts <ingest.json> <out.pdf> [limit]
import fs from 'node:fs';
import type { Persona, ProductDocument } from '../../shared/types.js';
import { writeProduct } from '../../server/agents/writer/index.js';
import { mockLlm } from './mock-llm.js';
import { EMPIRE_MAKER } from '../../server/publisher.js';
import { renderProduct } from '../../server/render/index.js';

const [file, out, lim] = process.argv.slice(2);
const doc = (JSON.parse(fs.readFileSync(file, 'utf8')) as { document: ProductDocument }).document;
const persona = JSON.parse(fs.readFileSync('personas/flavor-hunter.json', 'utf8')) as Persona;
const examples = JSON.parse(fs.readFileSync('personas/flavor-hunter.examples.json', 'utf8')).examples as { source: { title: string }; rewrite: Record<string, unknown> }[];
persona.examples = examples as Persona['examples'];

const fake = mockLlm(examples);

const t0 = Date.now();
const res = await writeProduct({
  llm: fake,
  persona,
  brand: EMPIRE_MAKER.brand,
  source: doc,
  existingDraft: null,
  settings: { personaId: persona.id, convenience: 'upgrade', scope: 'beef', minTransformation: 0.85, limit: Number(lim ?? 40) },
  progress: () => {},
});
const r = res.report;
const by = (s: string) => r.sections.filter((x) => x.status === s).length;
console.log(`written ${by('written')} · flagged ${by('flagged')} · cut ${by('cut')} · failed ${by('failed')} · calls ${r.usage.calls} · avg new wording ${r.avgTransformation !== null ? Math.round(r.avgTransformation * 100) + '%' : '-'}`);
console.log('retries forced by copy check:', r.sections.filter((s) => s.attempts > 1).length);
for (const s of r.sections.filter((x) => x.status === 'cut').slice(0, 5)) console.log('  cut:', s.title, '—', s.notes[0]);
console.log('draft title:', res.draft.title, '—', res.draft.subtitle, '| sections:', res.draft.deliverables[0].sections.length);

const pdf = await renderProduct({ productId: 'mock', doc: { ...res.draft, deliverables: [{ ...res.draft.deliverables[0], sections: res.draft.deliverables[0].sections.slice(0, Number(lim ?? 40)) }] }, brand: EMPIRE_MAKER.brand, authorName: 'Test Author', authorShortBio: 'writes about beef.', catalog: [] });
fs.writeFileSync(out, pdf.pdf);
console.log(`rendered ${pdf.pages} pages in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${out}`);
