import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

function findChrome(): string | null {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  // Replit (Nix) puts chromium on PATH
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const name of ['chromium', 'chromium-browser', 'google-chrome']) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

export const config = {
  port: num(process.env.PORT, 3000),
  isProd: process.env.NODE_ENV === 'production',
  dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
  databaseUrl: process.env.DATABASE_URL ?? null, // Postgres; falls back to embedded PGlite in ./data
  storage: (process.env.STORAGE ?? 'local') as 'local' | 'replit',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
  ingestModel: process.env.INGEST_MODEL ?? 'claude-sonnet-5-5',
  reviewModel: process.env.REVIEW_MODEL ?? 'claude-haiku-5-5',
  writerModel: process.env.WRITER_MODEL ?? 'claude-sonnet-5-5',
  personaModel: process.env.PERSONA_MODEL ?? 'claude-sonnet-5-5',
  writerConcurrency: num(process.env.WRITER_CONCURRENCY, 4),
  // Optional: $ per million tokens, to show dollar estimates before a Writer run
  priceInPerMTok: process.env.PRICE_IN_PER_MTOK ? Number(process.env.PRICE_IN_PER_MTOK) : null,
  priceOutPerMTok: process.env.PRICE_OUT_PER_MTOK ? Number(process.env.PRICE_OUT_PER_MTOK) : null,
  // Images: FLUX.2 by Black Forest Labs (bfl.ai). IMAGE_PROVIDER=mock draws placeholders for offline tests.
  bflApiKey: process.env.BFL_API_KEY ?? null,
  imageProvider: (process.env.IMAGE_PROVIDER ?? 'flux') as 'flux' | 'mock',
  imageModel: process.env.IMAGE_MODEL ?? 'flux-2-pro',
  imageDirectorModel: process.env.IMAGE_DIRECTOR_MODEL ?? 'claude-sonnet-5-5',
  imageConcurrency: num(process.env.IMAGE_CONCURRENCY, 4),
  refineMaxSections: num(process.env.REFINE_MAX_SECTIONS, 40),
  refineBelowConfidence: num(process.env.REFINE_BELOW_CONFIDENCE, 0.7),
  chromePath: findChrome(),
  appPassword: process.env.APP_PASSWORD ?? null,
};
