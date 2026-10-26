// Usage: npm run render -- data/cli/book.json [out.pdf]
// Renders an ingest result (from `npm run ingest`) without the server/DB.
import fs from 'node:fs';
import path from 'node:path';
import type { ProductDocument } from '../shared/types.js';
import { EMPIRE_MAKER } from '../server/publisher.js';
import { renderProduct } from '../server/render/index.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run render -- path/to/ingest.json [out.pdf]');
  process.exit(1);
}
const out = process.argv[3] ?? file.replace(/\.json$/i, '.pdf');
const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { document: ProductDocument };

const t0 = Date.now();
const res = await renderProduct(
  {
    productId: path.basename(file, '.json'),
    doc: data.document,
    brand: EMPIRE_MAKER.brand,
    authorName: null,
    authorShortBio: null,
    catalog: [],
  },
  (pct, msg) => process.stdout.write(`\r${String(pct).padStart(3)}%  ${msg.padEnd(50)}`),
);
process.stdout.write('\n');
fs.writeFileSync(out, res.pdf);
console.log(`Wrote ${out} — ${res.pages} pages in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
