// Single-user password gate with a login page + cookie.
// Replaces HTTP Basic auth, which browsers block inside iframes (Replit's preview pane is one).
import crypto from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';

const COOKIE = 'emp_session';
const OPEN = new Set(['/login', '/logout', '/api/health', '/favicon.png', '/em-mark-white.png', '/em-wordmark-white.png']);

const tokenFor = (password: string) => crypto.createHmac('sha256', password).update('empire-maker-pipeline/session/v1').digest('hex');

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const isHttps = (req: Request) => req.secure || req.headers['x-forwarded-proto'] === 'https';

function setCookie(req: Request, res: Response, value: string, maxAgeSec: number) {
  // Cross-site iframe (Replit preview) needs SameSite=None; Secure. Plain-http local dev falls back to Lax.
  const attrs = isHttps(req) ? 'SameSite=None; Secure' : 'SameSite=Lax';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; ${attrs}; Max-Age=${maxAgeSec}`);
}

const page = (error: string | null) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · Empire Maker Pipeline</title><link rel="icon" href="/favicon.png">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0B0B0C;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#17181b;padding:16px}
form{background:#fff;border-radius:10px;padding:28px;width:100%;max-width:360px;display:grid;gap:14px;border-top:4px solid #C9A54C}
.brand{display:flex;align-items:center;gap:10px;background:#0B0B0C;border-radius:6px;padding:10px 12px}.brand img.m{height:28px}.brand img.w{height:13px}
h1{font-size:18px;margin:4px 0 0}label{display:grid;gap:6px;font-size:13px;font-weight:600;color:#5f636b}
input{font:inherit;font-size:15px;padding:10px 12px;border:1px solid #cfcac0;border-radius:6px;min-height:44px}
input:focus{outline:2px solid #C9A54C;outline-offset:1px}
button{font:inherit;font-weight:700;min-height:44px;border:0;border-radius:6px;background:#0B0B0C;color:#fff;cursor:pointer}
button:hover{background:#26272b}.err{background:#fbe6e3;color:#a3271c;border-radius:6px;padding:8px 10px;font-size:13px}
</style></head><body>
<form method="post" action="/login">
<div class="brand"><img class="m" src="/em-mark-white.png" alt=""><img class="w" src="/em-wordmark-white.png" alt="Empire Maker Publishing"></div>
<h1>Sign in to the pipeline</h1>
${error ? `<div class="err" role="alert">${error}</div>` : ''}
<label>Password<input type="password" name="password" autocomplete="current-password" autofocus required></label>
<button type="submit">Sign in</button>
</form></body></html>`;

export function installAuth(app: Express, password: string | null) {
  if (!password) return;
  const token = tokenFor(password);
  app.set('trust proxy', true);

  app.get('/login', (_req, res) => {
    res.type('html').send(page(null));
  });
  app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
    const given = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!safeEqual(given, password)) {
      res.status(401).type('html').send(page('Wrong password.'));
      return;
    }
    setCookie(req, res, token, 60 * 60 * 24 * 30);
    res.redirect(303, '/');
  });
  app.get('/logout', (req, res) => {
    setCookie(req, res, '', 0);
    res.redirect(303, '/login');
  });

  app.use((req, res, next) => {
    if (OPEN.has(req.path)) return next();
    const got = readCookie(req, COOKIE);
    if (got && safeEqual(got, token)) return next();
    if (req.path.startsWith('/api/')) {
      res.status(401).json({ error: 'Signed out — reload the page and sign in.' });
      return;
    }
    res.redirect(302, '/login');
  });
}
