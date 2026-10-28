// Raw extraction: PDF → positioned text items → lines and segments per page.
// Positions matter: they are how we tell columns, headings, callouts and tables apart.
import '../../polyfills.js';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const standardFontDataUrl = path.join(pdfjsRoot, 'standard_fonts') + path.sep;

export interface TextItem {
  str: string;
  x: number; // left, pt
  y: number; // baseline distance from page TOP, pt
  w: number;
  size: number;
  bold: boolean;
  italic: boolean;
}

export interface Segment {
  text: string;
  x0: number;
  x1: number;
  size: number;
  bold: boolean;
}

export interface Line {
  page: number;
  text: string;
  x0: number;
  x1: number;
  y: number; // baseline from top
  size: number; // dominant font size
  bold: boolean; // majority of chars bold
  segments: Segment[];
  items: TextItem[]; // raw runs, for column-aware parsers (recipes)
}

export interface PageLayout {
  page: number; // 1-based
  width: number;
  height: number;
  lines: Line[];
}

export interface ExtractResult {
  pageCount: number;
  meta: { title: string | null; author: string | null; producer: string | null; creator: string | null };
  pages: PageLayout[];
}

// Common mis-decoded characters in PLR files (UTF-8 read as cp1251/cp1252 somewhere upstream).
const MOJIBAKE: [RegExp, string][] = [
  [/В®|Â®/g, '®'],
  [/в„ў|â„¢/g, '™'],
  [/вЂ™|â€™/g, '’'],
  [/вЂњ|â€œ/g, '“'],
  [/вЂќ|â€\x9d/g, '”'],
  [/вЂ¦|â€¦/g, '…'],
  [/вЂ"|â€"/g, '—'],
  [/Â°|В°/g, '°'],
  [/Â /g, ' '],
];
export const fixMojibake = (s: string) => MOJIBAKE.reduce((t, [re, r]) => t.replace(re, r), s);

const BOLD_RE = /bold|black|heavy|semibold|demi/i;
const ITALIC_RE = /italic|oblique/i;

export async function extractPdf(
  data: Uint8Array,
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractResult> {
  const task = getDocument({
    data,
    standardFontDataUrl,
    fontExtraProperties: true,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;

  let meta: ExtractResult['meta'] = { title: null, author: null, producer: null, creator: null };
  try {
    const m = await doc.getMetadata();
    const info = (m?.info ?? {}) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    meta = { title: s(info.Title), author: s(info.Author), producer: s(info.Producer), creator: s(info.Creator) };
  } catch {
    /* metadata is optional */
  }

  const pages: PageLayout[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    // Loads fonts into commonObjs so we can read real font names (bold/italic detection).
    await page.getOperatorList();

    const fontInfo = new Map<string, { bold: boolean; italic: boolean }>();
    const items: TextItem[] = [];
    for (const raw of tc.items) {
      if (!('str' in raw)) continue;
      const str = fixMojibake(raw.str);
      if (!str || !str.trim()) continue;
      let fi = fontInfo.get(raw.fontName);
      if (!fi) {
        let name = '';
        try {
          const f = page.commonObjs.get(raw.fontName) as { name?: string; bold?: boolean; italic?: boolean } | undefined;
          name = f?.name ?? '';
          fi = { bold: Boolean(f?.bold) || BOLD_RE.test(name), italic: Boolean(f?.italic) || ITALIC_RE.test(name) };
        } catch {
          fi = { bold: false, italic: false };
        }
        fontInfo.set(raw.fontName, fi);
      }
      const [a, b, , , e, f] = raw.transform as number[];
      const size = Math.hypot(a, b) || raw.height || 10;
      items.push({ str, x: e, y: vp.height - f, w: raw.width, size, bold: fi.bold, italic: fi.italic });
    }

    pages.push({ page: p, width: vp.width, height: vp.height, lines: buildLines(p, items) });
    page.cleanup();
    onProgress?.(p, doc.numPages);
  }

  const pageCount = doc.numPages;
  await task.destroy();
  return { pageCount, meta, pages };
}

/** Group items into visual lines (same baseline), split each line into segments at wide gaps. */
export function buildLines(page: number, items: TextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: TextItem[][] = [];
  for (const it of sorted) {
    const g = groups[groups.length - 1];
    if (g) {
      const ref = g[0];
      if (Math.abs(it.y - ref.y) <= Math.max(1.5, 0.35 * Math.min(it.size, ref.size))) {
        g.push(it);
        continue;
      }
    }
    groups.push([it]);
  }

  return groups.map((g) => {
    g.sort((a, b) => a.x - b.x);
    const segments: Segment[] = [];
    let cur: Segment | null = null;
    let lastEnd = -Infinity;
    for (const it of g) {
      const gap = it.x - lastEnd;
      const segGap = Math.max(2.2 * it.size, 18);
      if (!cur || gap > segGap) {
        cur = { text: it.str, x0: it.x, x1: it.x + it.w, size: it.size, bold: it.bold };
        segments.push(cur);
      } else {
        const needsSpace = gap > 0.15 * it.size && !/\s$/.test(cur.text) && !/^\s/.test(it.str);
        cur.text += (needsSpace ? ' ' : '') + it.str;
        cur.x1 = Math.max(cur.x1, it.x + it.w);
        cur.bold = cur.bold && it.bold;
        cur.size = Math.max(cur.size, it.size);
      }
      lastEnd = Math.max(lastEnd, it.x + it.w);
    }
    for (const s of segments) s.text = s.text.replace(/\s+/g, ' ').trim();
    const chars = g.reduce((n, it) => n + it.str.length, 0) || 1;
    const boldChars = g.reduce((n, it) => n + (it.bold ? it.str.length : 0), 0);
    // dominant size = size with the most characters
    const sizeCount = new Map<number, number>();
    for (const it of g) {
      const k = Math.round(it.size * 2) / 2;
      sizeCount.set(k, (sizeCount.get(k) ?? 0) + it.str.length);
    }
    const size = [...sizeCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const kept = segments.filter((s) => s.text);
    return {
      page,
      text: kept.map((s) => s.text).join('   '),
      x0: Math.min(...kept.map((s) => s.x0)),
      x1: Math.max(...kept.map((s) => s.x1)),
      y: g[0].y,
      size,
      bold: boldChars / chars > 0.6,
      segments: kept,
      items: g,
    };
  }).filter((l) => l.segments.length > 0);
}
