// Page-level cleanup: table-of-contents detection, running headers/footers, page numbers.
import type { Line, PageLayout } from './extract.js';

export interface TocEntry {
  title: string;
  page: number | null;
}

export interface CleanResult {
  pages: PageLayout[]; // content pages only, junk lines removed
  tocPages: number[];
  tocEntries: TocEntry[];
  stripped: { text: string; count: number; pages: number[] }[];
}

const PAGE_NUM_RE = /^(page\s*)?[-–—]?\s*\d{1,4}\s*[-–—]?(\s*(of|\/)\s*\d{1,4})?$/i;
const TOC_TITLE_RE = /^(table\s+of\s+contents|contents|in\s+this\s+(book|guide))$/i;
const TOC_LINE_RE = /(\.{3,}|…)\s*\d{1,4}$/;

// Structural labels that repeat on every page but are content, not running headers.
const PROTECTED_RE = /^(ingredients|directions|instructions|method|preparation|notes?)\b/i;

const norm = (s: string) => s.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

function isTocLine(l: Line): TocEntry | null {
  const last = l.segments[l.segments.length - 1];
  if (l.segments.length >= 2 && /^\d{1,4}$/.test(last.text)) {
    return { title: l.segments.slice(0, -1).map((s) => s.text).join(' ').trim(), page: Number(last.text) };
  }
  const m = l.text.match(/^(.*?)(?:\s*(?:\.{3,}|…)\s*)(\d{1,4})$/);
  if (m && TOC_LINE_RE.test(l.text)) return { title: m[1].trim(), page: Number(m[2]) };
  return null;
}

export function cleanPages(pages: PageLayout[]): CleanResult {
  const tocPages: number[] = [];
  const tocEntries: TocEntry[] = [];

  // 1) Table of contents pages. We keep the entries (useful for validation) and drop the pages.
  const contentPages: PageLayout[] = [];
  for (const pg of pages) {
    const body = pg.lines.filter((l) => !PAGE_NUM_RE.test(l.text));
    const hasTitle = body.some((l) => TOC_TITLE_RE.test(l.text.trim()) && l.y < pg.height * 0.35);
    const entries = body.map(isTocLine).filter((e): e is TocEntry => !!e && e.title.length > 1);
    const ratio = body.length ? entries.length / body.length : 0;
    if ((entries.length >= 5 && ratio >= 0.55) || (hasTitle && entries.length >= 3 && ratio >= 0.3)) {
      tocPages.push(pg.page);
      tocEntries.push(...entries);
    } else {
      contentPages.push(pg);
    }
  }

  // 2) Running headers/footers: same normalized text in the top/bottom band of several pages.
  const zoneKeys = new Map<string, { text: string; pages: Set<number> }>();
  const inZone = (l: Line, pg: PageLayout) => l.y < pg.height * 0.12 || l.y > pg.height * 0.9;
  for (const pg of contentPages) {
    const seen = new Set<string>();
    for (const l of pg.lines) {
      if (!inZone(l, pg)) continue;
      if (l.segments.some((s) => PROTECTED_RE.test(s.text.trim()))) continue;
      for (const key of [norm(l.text), ...l.segments.map((s) => norm(s.text))]) {
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const e = zoneKeys.get(key) ?? { text: l.text, pages: new Set<number>() };
        e.pages.add(pg.page);
        zoneKeys.set(key, e);
      }
    }
  }
  const minRepeat = Math.max(3, Math.ceil(contentPages.length * 0.08));
  const running = new Set([...zoneKeys.entries()].filter(([, v]) => v.pages.size >= minRepeat).map(([k]) => k));

  // A running label also shows up just below the header band (e.g. "PART 1 — FREELANCING WITH AI").
  const firstLineKeys = new Map<string, Set<number>>();
  for (const pg of contentPages) {
    const first = pg.lines.find((l) => !running.has(norm(l.text)) && !PAGE_NUM_RE.test(l.text));
    if (!first || first.y > pg.height * 0.2) continue;
    const k = norm(first.text);
    const s = firstLineKeys.get(k) ?? new Set<number>();
    s.add(pg.page);
    firstLineKeys.set(k, s);
  }
  for (const [k, s] of firstLineKeys) {
    if (s.size >= 3 && /[a-z]/.test(k)) {
      // only all-caps labels qualify — a mixed-case first line is real content
      const sample = contentPages.flatMap((p) => p.lines).find((l) => norm(l.text) === k);
      if (sample && sample.text === sample.text.toUpperCase()) running.add(k);
    }
  }

  const stripCount = new Map<string, { text: string; count: number; pages: number[] }>();
  const record = (text: string, page: number) => {
    const k = norm(text);
    const e = stripCount.get(k) ?? { text, count: 0, pages: [] };
    e.count++;
    if (e.pages.length < 50) e.pages.push(page);
    stripCount.set(k, e);
  };

  const cleaned = contentPages.map((pg) => {
    const lines: Line[] = [];
    for (const l of pg.lines) {
      const zone = inZone(l, pg);
      if (zone && PAGE_NUM_RE.test(l.text.trim())) {
        record('[page number]', pg.page);
        continue;
      }
      if (running.has(norm(l.text))) {
        record(l.text, pg.page);
        continue;
      }
      if (zone && l.segments.length > 1) {
        // header lines like "BOOK TITLE ........ Seller Name": drop running segments, keep the rest
        const keep = l.segments.filter((s) => !running.has(norm(s.text)) && !PAGE_NUM_RE.test(s.text));
        if (keep.length !== l.segments.length) {
          record(l.text, pg.page);
          if (!keep.length) continue;
          lines.push({ ...l, segments: keep, text: keep.map((s) => s.text).join('   '), x0: keep[0].x0, x1: keep[keep.length - 1].x1 });
          continue;
        }
      }
      lines.push(l);
    }
    return { ...pg, lines };
  });

  return {
    pages: cleaned,
    tocPages,
    tocEntries,
    stripped: [...stripCount.values()].sort((a, b) => b.count - a.count),
  };
}
