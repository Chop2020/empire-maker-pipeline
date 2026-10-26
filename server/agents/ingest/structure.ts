// Generic structure recovery for non-recipe pages: headings, paragraphs, lists, callouts, tables.
import type { Block, CalloutVariant } from '../../../shared/types.js';
import type { Line, PageLayout } from './extract.js';
import { newId } from '../../util/ids.js';

const BULLET_RE = /^([•▪●◦‣\-–*✓✔☐□])\s+/;
const ORDERED_RE = /^(\d{1,2})[.)]\s+/;

export type LineKind = 'h1' | 'h2' | 'h3' | 'label' | 'bullet' | 'ordered' | 'row' | 'text';

export interface ClassifiedLine extends Line {
  kind: LineKind;
}

export interface StructureStats {
  bodySize: number;
  lineGap: number;
}

export function computeStats(pages: PageLayout[]): StructureStats {
  const sizeWeight = new Map<number, number>();
  const gaps: number[] = [];
  for (const pg of pages) {
    pg.lines.forEach((l, i) => {
      const k = Math.round(l.size * 2) / 2;
      sizeWeight.set(k, (sizeWeight.get(k) ?? 0) + l.text.length);
      const prev = pg.lines[i - 1];
      if (prev && Math.abs(prev.size - l.size) < 0.6) {
        const g = l.y - prev.y;
        if (g > 0 && g < l.size * 2.2) gaps.push(g);
      }
    });
  }
  const bodySize = [...sizeWeight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
  gaps.sort((a, b) => a - b);
  const lineGap = gaps[Math.floor(gaps.length / 2)] ?? bodySize * 1.3;
  return { bodySize, lineGap };
}

const isAllCaps = (s: string) => /[A-Z]{2}/.test(s) && s === s.toUpperCase() && !/[a-z]/.test(s);
const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

export function classifyLine(l: Line, st: StructureStats): LineKind {
  const t = l.text.trim();
  const ratio = l.size / st.bodySize;
  if (l.segments.length >= 2) return 'row';
  if (BULLET_RE.test(t)) return 'bullet';
  if (ORDERED_RE.test(t) && wordCount(t) > 2) return 'ordered';
  if (ratio >= 1.6) return 'h1';
  if (ratio >= 1.25 && wordCount(t) <= 16) return 'h2';
  if (isAllCaps(t) && wordCount(t) <= 6 && t.length <= 48 && !/[.!?]$/.test(t)) return 'label';
  if (l.bold && ratio >= 1.02 && wordCount(t) <= 14 && !/[.,;]$/.test(t)) return 'h3';
  if (l.bold && wordCount(t) <= 10 && !/[.,;:]$/.test(t) && t.length < 70) return 'h3';
  return 'text';
}

/**
 * Second pass over classified lines: big type that is really running text (centered intro copy,
 * pull quotes that wrap) gets demoted to text.
 */
export function demoteFalseHeadings(lines: ClassifiedLine[]): ClassifiedLine[] {
  const isHead = (k: LineKind) => k === 'h2' || k === 'h3';
  const out = lines.map((l) => ({ ...l }));
  for (let i = 0; i < out.length; i++) {
    const l = out[i];
    if (!isHead(l.kind)) continue;
    const t = l.text.trim();
    const words = wordCount(t);
    if (words > 8 && /[.!?]["”]?$/.test(t)) l.kind = 'text';
    const nx = out[i + 1];
    if (
      nx &&
      nx.page === l.page &&
      Math.abs(nx.size - l.size) < 0.6 &&
      nx.y - l.y < l.size * 1.7 &&
      /^[a-z]/.test(nx.text.trim())
    ) {
      l.kind = 'text';
      nx.kind = 'text';
    }
    const pv = out[i - 1];
    if (pv && pv.kind === 'text' && pv.page === l.page && Math.abs(pv.size - l.size) < 0.6 && l.y - pv.y < l.size * 1.7 && /^[a-z]/.test(t)) {
      l.kind = 'text';
    }
  }
  return out;
}

const CALLOUT_VARIANTS: [RegExp, CalloutVariant][] = [
  [/tip|hint|pro move|quick win/i, 'tips'],
  [/prompt/i, 'prompts'],
  [/example|case study|story|in practice/i, 'example'],
  [/sample|output|template/i, 'sample'],
  [/note|warning|important|caution|remember|key takeaway/i, 'note'],
];

export function calloutVariant(label: string): CalloutVariant {
  for (const [re, v] of CALLOUT_VARIANTS) if (re.test(label)) return v;
  return 'generic';
}

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s\-—–/(])([a-z])/g, (_, p, c) => p + c.toUpperCase()).replace(/\bAi\b/g, 'AI');

/**
 * Turn a run of classified lines (in reading order, possibly across pages) into blocks.
 * Headings are returned as heading blocks; the caller splits sections on them.
 */
export function linesToBlocks(lines: ClassifiedLine[], st: StructureStats, pageOf?: Map<string, number>): Block[] {
  const blocks: Block[] = [];
  const track = <T extends Block>(b: T, page: number): T => {
    pageOf?.set(b.id, page);
    return b;
  };
  let callout: Extract<Block, { type: 'callout' }> | null = null;
  const target = () => (callout ? callout.blocks : blocks);
  const paraBreak = (gap: number) => gap > Math.max(st.lineGap * 1.3, st.bodySize * 1.45);

  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    const prev = lines[i - 1];
    const newPage = prev && prev.page !== l.page;

    if (l.kind === 'h1' || l.kind === 'h2' || l.kind === 'h3') {
      callout = null;
      // merge multi-line headings of the same kind
      let text = l.text;
      let j = i + 1;
      while (
        j < lines.length &&
        lines[j].kind === l.kind &&
        lines[j].page === l.page &&
        lines[j].y - lines[j - 1].y < l.size * 1.6
      ) {
        text += ' ' + lines[j].text;
        j++;
      }
      const level = l.kind === 'h1' ? 1 : l.kind === 'h2' ? 2 : 3;
      blocks.push(track({ id: newId('b'), type: 'heading', level, text: text.replace(/\s+/g, ' ').trim() }, l.page));
      i = j;
      continue;
    }

    if (l.kind === 'label') {
      const label = titleCase(l.text.trim());
      callout = { id: newId('b'), type: 'callout', variant: calloutVariant(label), label, blocks: [] };
      blocks.push(track(callout, l.page));
      i++;
      continue;
    }

    if (l.kind === 'row') {
      callout = null; // tables end callouts
      const colStarts = l.segments.map((s) => s.x0);
      const rows: string[][] = [];
      let header: string[] | null = null;
      let rowY = -Infinity;
      let current: string[] | null = null;
      let j = i;
      while (j < lines.length) {
        const r = lines[j];
        if (j > i && r.page !== lines[j - 1].page) break;
        if (j > i && r.y - lines[j - 1].y > st.lineGap * 3.2) break;
        const aligned = r.segments.every((s) => colStarts.some((x) => Math.abs(x - s.x0) < 14));
        const closeBelow = j > i && r.y - lines[j - 1].y < st.lineGap * 1.6;
        if (j > i && r.kind !== 'row' && !(aligned && closeBelow && r.kind !== 'h1' && r.kind !== 'h2')) break;
        const cells = colStarts.map(() => '');
        for (const s of r.segments) {
          let best = 0;
          colStarts.forEach((x, k) => {
            if (s.x0 >= x - 14) best = k;
          });
          cells[best] = cells[best] ? `${cells[best]} ${s.text}` : s.text;
        }
        if (j === i && cells.every((c) => !c || isAllCaps(c))) {
          header = cells.map((c) => titleCase(c));
          rowY = r.y;
          j++;
          continue;
        }
        const newRow = !current || r.y - rowY > st.lineGap * 1.45;
        if (newRow) {
          current = cells;
          rows.push(current);
        } else {
          cells.forEach((c, k) => {
            if (c) current![k] = current![k] ? `${current![k]} ${c}` : c;
          });
        }
        rowY = r.y;
        j++;
      }
      if (rows.length || header) blocks.push(track({ id: newId('b'), type: 'table', header, rows }, l.page));
      i = j;
      continue;
    }

    if (l.kind === 'bullet' || l.kind === 'ordered') {
      const ordered = l.kind === 'ordered';
      const items: string[] = [];
      const checklist = /^[☐□✓✔]/.test(l.text.trim());
      let j = i;
      let lastY = l.y;
      while (j < lines.length) {
        const r = lines[j];
        const gap = r.page === lines[j - 1]?.page ? r.y - lastY : 0;
        if (j > i && r.kind === (ordered ? 'ordered' : 'bullet') && (gap < st.lineGap * 3 || r.page !== lines[j - 1].page)) {
          items.push(r.text.replace(ordered ? ORDERED_RE : BULLET_RE, '').trim());
        } else if (j === i) {
          items.push(r.text.replace(ordered ? ORDERED_RE : BULLET_RE, '').trim());
        } else if (r.kind === 'text' && r.page === lines[j - 1].page && gap < r.size * 1.7 && r.x0 >= l.x0 - 3) {
          items[items.length - 1] += ' ' + r.text.trim();
        } else break;
        lastY = r.y;
        j++;
      }
      target().push(
        track(
          checklist ? { id: newId('b'), type: 'checklist', items } : { id: newId('b'), type: 'list', ordered, items },
          l.page,
        ),
      );
      i = j;
      continue;
    }

    // paragraph text
    if (newPage) callout = null;
    let text = l.text.trim();
    let j = i + 1;
    let innerGap = 0; // line spacing inside this paragraph, learned from its first two lines
    while (j < lines.length) {
      const r = lines[j];
      if (r.kind !== 'text') break;
      if (r.page !== lines[j - 1].page) {
        // continue a sentence across a page break only if the previous line didn't end one
        if (/[.!?:"”]$/.test(text)) break;
      } else {
        const gap = r.y - lines[j - 1].y;
        if (Math.abs(r.size - lines[j - 1].size) > 0.8) break;
        // loosely spaced one-liners ("Term — definition.") are separate paragraphs
        if (gap > r.size * 1.75 && /[.!?]["”]?$/.test(text)) break;
        if (innerGap ? gap > innerGap * 1.25 : gap > Math.max(r.size * 1.6, st.lineGap * 1.3) || paraBreak(gap)) break;
        if (!innerGap) innerGap = gap;
      }
      text = /[a-z]-$/i.test(text) ? text.slice(0, -1) + r.text.trim() : `${text} ${r.text.trim()}`;
      j++;
    }
    target().push(track({ id: newId('b'), type: 'paragraph', text: text.replace(/\s+/g, ' ') }, l.page));
    i = j;
  }

  // drop empty callouts (a label with nothing under it becomes a heading)
  return blocks.map((b) =>
    b.type === 'callout' && b.blocks.length === 0 ? ({ id: b.id, type: 'heading', level: 3, text: b.label } as Block) : b,
  );
}
