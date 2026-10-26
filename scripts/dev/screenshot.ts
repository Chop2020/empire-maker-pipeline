// Dev helper: screenshot a running app page. Usage: tsx scripts/dev/screenshot.ts <url> <out.png> [width]
import puppeteer from 'puppeteer-core';
import { config } from '../../server/config.js';
const [url, out, w] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: config.chromePath!, args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: Number(w ?? 1360), height: 900 });
await p.goto(url, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));
await p.screenshot({ path: out as `${string}.png`, fullPage: false });
await b.close();
