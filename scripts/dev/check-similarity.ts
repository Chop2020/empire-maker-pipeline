// Sanity check for the transformation metric using the approved Flavor Hunter examples.
import fs from 'node:fs';
import { copyCheck } from '../../server/agents/writer/similarity.js';

const src = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ex = JSON.parse(fs.readFileSync('personas/flavor-hunter.examples.json', 'utf8'));
const recipes = Object.fromEntries(
  src.document.deliverables[0].sections.filter((s: any) => s.kind === 'recipe').map((s: any) => [s.title, s.blocks[0]]),
);
for (const e of ex.examples) {
  const s = recipes[e.source.title];
  const before = s.directions.join(' ');
  const after = [e.rewrite.headnote, ...e.rewrite.directions].join(' ');
  const self = copyCheck(before, before);
  const c = copyCheck(before, after);
  console.log(`${e.source.title}\n  identical text: ${(self.transformation * 100).toFixed(0)}% new · rewrite: ${(c.transformation * 100).toFixed(0)}% new`);
  if (c.copiedPhrases.length) console.log('  copied:', c.copiedPhrases.slice(0, 4).join(' | '));
}
