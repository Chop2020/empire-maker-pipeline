import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { config } from './config.js';
import { getDb } from './db/index.js';
import { getJob, jobsForProduct, recoverJobs } from './jobs.js';
import {
  HttpError,
  createFromUpload,
  deleteProduct,
  getProduct,
  listProducts,
  readRendered,
  readSource,
  reingest,
  requestRender,
  updateLicense,
  updateMeta,
} from './products.js';
import { EMPIRE_MAKER } from './publisher.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));

// Optional single-user password (Replit URLs are public). Browser shows its own login prompt.
if (config.appPassword) {
  app.use((req, res, next) => {
    const h = req.headers.authorization ?? '';
    const [, b64] = h.split(' ');
    const pass = b64 ? Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':') : '';
    if (pass === config.appPassword) return next();
    res.setHeader('WWW-Authenticate', 'Basic realm="Empire Maker Pipeline"');
    res.status(401).send('Authentication required');
  });
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 250 * 1024 * 1024 } });
const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);
const id = (req: Request) => String(req.params.id);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, chrome: Boolean(config.chromePath), ai: Boolean(config.anthropicApiKey), storage: config.storage, db: config.databaseUrl ? 'postgres' : 'pglite' });
});

app.get('/api/publisher', (_req, res) => {
  res.json(EMPIRE_MAKER.brand);
});

app.get('/api/products', wrap(async (_req, res) => res.json(await listProducts())));

app.post(
  '/api/products',
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Attach a PDF in the "file" field.');
    res.status(201).json(await createFromUpload(req.file.originalname, req.file.buffer));
  }),
);

app.get('/api/products/:id', wrap(async (req, res) => res.json(await getProduct(id(req)))));
app.patch('/api/products/:id', wrap(async (req, res) => res.json(await updateMeta(id(req), req.body ?? {}))));
app.patch('/api/products/:id/license', wrap(async (req, res) => res.json(await updateLicense(id(req), req.body ?? {}))));
app.post('/api/products/:id/reingest', wrap(async (req, res) => res.status(202).json(await reingest(id(req)))));
app.post('/api/products/:id/render', wrap(async (req, res) => res.status(202).json(await requestRender(id(req)))));
app.get('/api/products/:id/jobs', wrap(async (req, res) => res.json(await jobsForProduct(id(req)))));
app.delete(
  '/api/products/:id',
  wrap(async (req, res) => {
    await deleteProduct(id(req));
    res.status(204).end();
  }),
);

const sendPdf = (res: Response, data: Buffer, fileName: string, inline: boolean) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${fileName.replace(/"/g, '')}"`);
  res.send(data);
};
app.get(
  '/api/products/:id/download',
  wrap(async (req, res) => {
    const f = await readRendered(id(req));
    sendPdf(res, f.data, f.fileName, req.query.inline === '1');
  }),
);
app.get(
  '/api/products/:id/source',
  wrap(async (req, res) => {
    const f = await readSource(id(req));
    sendPdf(res, f.data, f.fileName, true);
  }),
);

app.get(
  '/api/jobs/:id',
  wrap(async (req, res) => {
    const job = await getJob(id(req));
    if (!job) throw new HttpError(404, 'Job not found');
    res.json(job);
  }),
);

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' });
});

async function start() {
  await getDb();
  await recoverJobs();

  if (config.isProd) {
    const dist = path.join(root, 'dist', 'client');
    if (!fs.existsSync(dist)) throw new Error('Client build missing — run `npm run build` first.');
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    // Vite in middleware mode: one process, one port — what Replit expects.
    const { createServer } = await import('vite');
    const vite = await createServer({ root: path.join(root, 'client'), server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`Empire Maker Pipeline on http://localhost:${config.port}`);
    console.log(`  db: ${config.databaseUrl ? 'postgres' : 'pglite (./data)'} · storage: ${config.storage} · chromium: ${config.chromePath ?? 'NOT FOUND'} · AI refine: ${config.anthropicApiKey ? 'on' : 'off'}`);
  });
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
