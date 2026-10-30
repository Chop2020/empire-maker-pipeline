// Dev: run the duplicate finder and clearance scan on an ingest/DB dump. Usage: tsx scripts/dev/check-cleanup.ts <dump.json>
import fs from 'node:fs';
import type { ProductDocument, WriterReport } from '../../shared/types.js';
import { findDuplicates } from '../../server/agents/analyst/duplicates.js';
import { clearance } from '../../server/agents/analyst/clearance.js';
import { beefScope } from '../../server/agents/writer/scope.js';

const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) as { document: ProductDocument; draft?: ProductDocument; report?: WriterReport };
const dup = findDuplicates(d.document);
for (const g of dup.groups) console.log(g.kind.padEnd(10), g.similarity, '|', g.titles.join(' || '));
console.log('excluded', Object.keys(dup.excluded).length);
// clearance on the source, beef-only recipes, minus duplicates
const ex = new Set(Object.keys(dup.excluded));
for (const s of d.document.deliverables[0].sections) if (s.blocks[0]?.type === 'recipe' && !beefScope(s.blocks[0]).keep) ex.add(s.id);
const rep = clearance(d.document, 'source', null, ex);
console.log(rep.counts, 'ready', rep.ready);
for (const i of rep.items.filter((x) => x.kind !== 'not-rewritten')) console.log(i.kind.padEnd(18), '|', i.title, '|', i.detail);
