import fs from 'node:fs';
import { extractPdf } from '../../server/agents/ingest/extract.js';
const [file, from, to] = process.argv.slice(2);
const ex = await extractPdf(new Uint8Array(fs.readFileSync(file)));
for (const p of ex.pages.filter(p => p.page >= +from && p.page <= +to)) {
  console.log('--- page', p.page);
  let prev = 0;
  for (const l of p.lines) { console.log(l.y.toFixed(1).padStart(6), ('+' + (l.y - prev).toFixed(1)).padStart(6), l.size.toFixed(1), l.bold ? 'B' : ' ', l.x0.toFixed(0).padStart(4), l.segments.length, l.text.slice(0, 90)); prev = l.y; }
}
