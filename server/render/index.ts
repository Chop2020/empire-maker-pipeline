// Agent 4 (render half) — ProductDocument → print-ready PDF.
// Three passes: body (numbered pages), front matter (cover, title, imprint, contents with real page numbers),
// back cover (locked Empire Maker band). Merged into one PDF.
import puppeteer, { type Browser } from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';
import QRCode from 'qrcode';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { ProductDocument, PublisherBrand } from '../../shared/types.js';
import { config } from '../config.js';
import { websiteUrl } from '../publisher.js';
import { backHtml, bodyHtml, frontHtml, tocEntries, type CatalogItem, type RenderCtx } from './templates.js';
import { themeFor } from './theme.js';

export interface RenderInput {
  productId: string;
  doc: ProductDocument;
  brand: PublisherBrand;
  authorName: string | null;
  authorShortBio: string | null;
  catalog: CatalogItem[];
}

export type RenderProgress = (pct: number, message: string) => void;

const FOOTER = `<div style="width:100%;font-family:Helvetica,Arial,sans-serif;font-size:7px;letter-spacing:1px;color:#8A8F98;text-align:center;padding-bottom:6px"><span class="pageNumber"></span></div>`;

export async function launchBrowser(): Promise<Browser> {
  if (!config.chromePath) {
    throw new Error('Chromium not found. Set CHROME_PATH (on Replit, chromium comes from replit.nix).');
  }
  return puppeteer.launch({
    executablePath: config.chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });
}

async function htmlToPdf(browser: Browser, html: string, opts: { footer: boolean; outline?: boolean }) {
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 0 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const pdf = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: opts.footer,
      headerTemplate: '<span></span>',
      footerTemplate: opts.footer ? FOOTER : '<span></span>',
      outline: opts.outline ?? false,
      tagged: opts.outline ?? false,
      timeout: 0,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

/** Page number (1-based) of each top-level heading, in document order, from the PDF outline Chromium writes. */
async function outlinePages(pdf: Buffer): Promise<number[]> {
  const task = getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
  const doc = await task.promise;
  try {
    const outline = (await doc.getOutline()) ?? [];
    const out: number[] = [];
    // Chromium nests lower headings under h1s; the top level is our section titles.
    for (const item of outline) {
      let dest = item.dest as unknown;
      if (typeof dest === 'string') dest = await doc.getDestination(dest);
      if (!Array.isArray(dest) || !dest[0]) {
        out.push(0);
        continue;
      }
      const ref = dest[0];
      const idx = typeof ref === 'number' ? ref : await doc.getPageIndex(ref);
      out.push(idx + 1);
    }
    return out;
  } finally {
    await task.destroy();
  }
}

export async function renderProduct(input: RenderInput, progress: RenderProgress = () => {}): Promise<{ pdf: Buffer; pages: number }> {
  const theme = themeFor(input.doc.productType);
  const qrSvg = await QRCode.toString(`${websiteUrl(input.brand)}/?book=${encodeURIComponent(input.productId)}`, {
    type: 'svg',
    margin: 0,
    errorCorrectionLevel: 'M',
    color: { dark: '#0B0B0C', light: '#FFFFFF' },
  });
  const ctx: RenderCtx = {
    productId: input.productId,
    doc: input.doc,
    brand: input.brand,
    theme,
    authorName: input.authorName,
    authorShortBio: input.authorShortBio,
    catalog: input.catalog,
    qrSvg,
    year: new Date().getFullYear(),
  };

  progress(5, 'Starting renderer');
  const browser = await launchBrowser();
  try {
    progress(10, 'Laying out the body pages');
    const body = await htmlToPdf(browser, bodyHtml(ctx), { footer: true, outline: true });

    progress(60, 'Building contents with page numbers');
    const toc = tocEntries(input.doc);
    try {
      const pages = await outlinePages(body);
      toc.forEach((e, i) => (e.page = pages[i] || null));
    } catch {
      /* contents without page numbers is acceptable */
    }
    const front = await htmlToPdf(browser, frontHtml(ctx, toc), { footer: false });

    progress(80, 'Rendering back cover');
    const back = await htmlToPdf(browser, backHtml(ctx), { footer: false });

    progress(90, 'Assembling PDF');
    const out = await PDFDocument.create();
    for (const part of [front, body, back]) {
      const src = await PDFDocument.load(part);
      const copied = await out.copyPages(src, src.getPageIndices());
      copied.forEach((p) => out.addPage(p));
    }
    out.setTitle(input.doc.title);
    if (input.authorName) out.setAuthor(input.authorName);
    out.setCreator(input.brand.name);
    out.setProducer(input.brand.name);
    out.setSubject(input.doc.subtitle ?? input.doc.title);
    const bytes = await out.save();
    progress(100, 'Render complete');
    return { pdf: Buffer.from(bytes), pages: out.getPageCount() };
  } finally {
    await browser.close();
  }
}
