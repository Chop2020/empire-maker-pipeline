// Print what the beef-only scope rule keeps and cuts for an ingest JSON.
import fs from 'node:fs';
import { beefScope } from '../../server/agents/writer/scope.js';
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const R = d.document.deliverables[0].sections.filter((s: any) => s.kind === 'recipe').map((s: any) => s.blocks[0]);
const cut = R.map((r: any) => ({ r, v: beefScope(r) })).filter((x: any) => !x.v.keep);
const kept = R.length - cut.length;
const forSteak = R.filter((r: any) => beefScope(r).reason.startsWith('Made for'));
console.log(`recipes ${R.length} · keep ${kept} · cut ${cut.length}`);
for (const x of cut) console.log(`  CUT  ${x.r.title}  —  ${x.v.reason}`);
console.log(`kept as made-for-steak: ${forSteak.map((r: any) => r.title).join(' | ')}`);
