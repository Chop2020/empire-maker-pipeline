// Usage: npm run ingest -- path/to/file.pdf [out.json]
// Runs Agent 0 without the server/DB and writes the Product JSON + report.
import fs from 'node:fs';
import path from 'node:path';
import { ingestPdf } from '../server/agents/ingest/index.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run ingest -- path/to/file.pdf [out.json]');
  process.exit(1);
}
const out = process.argv[3] ?? path.join('data', 'cli', path.basename(file).replace(/\.pdf$/i, '') + '.json');
fs.mkdirSync(path.dirname(out), { recursive: true });

let last = -1;
const res = await ingestPdf(new Uint8Array(fs.readFileSync(file)), path.basename(file), (pct, msg) => {
  if (pct !== last) process.stdout.write(`\r${String(pct).padStart(3)}%  ${msg.padEnd(60)}`);
  last = pct;
});
process.stdout.write('\n');
fs.writeFileSync(out, JSON.stringify(res, null, 2));

const r = res.report;
console.log(`\nTitle:     ${res.document.title}${res.document.subtitle ? ' — ' + res.document.subtitle : ''}`);
console.log(`Type:      ${res.document.productType}`);
console.log(`Pages:     ${r.pageCount} (TOC pages: ${r.tocPages.length}, TOC entries: ${r.tocEntries.length})`);
console.log(`Sections:  ${r.sectionCount}   avg confidence: ${r.avgConfidence}`);
console.log(`Blocks:    ${JSON.stringify(r.blockCounts)}`);
console.log(`License:   ${res.license.status}`);
console.log(`AI refine: ${r.aiRefined ? 'yes' : 'no (set ANTHROPIC_API_KEY to enable)'}`);
console.log('Flags:');
for (const f of r.flags) console.log(`  [${f.severity}] ${f.kind}: ${f.message}${f.sample ? `\n           e.g. ${f.sample}` : ''}`);
console.log(`\nWrote ${out} in ${(r.durationMs / 1000).toFixed(1)}s`);
