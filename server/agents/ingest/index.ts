// Agent 0 — Ingest. PLR PDF → ProductDocument + IngestReport + License.
import type { Block, IngestReport, License, ProductDocument, Section } from '../../../shared/types.js';
import { newId } from '../../util/ids.js';
import { extractPdf } from './extract.js';
import { cleanPages } from './layout.js';
import { isRecipePage, parseRecipePage, parseRecipeContinuation, type RecipeGeometry } from './recipes.js';
import { classifyLine, computeStats, demoteFalseHeadings, linesToBlocks, type ClassifiedLine } from './structure.js';
import { classifyProductType, detectTitle, scanSource, scrapedSourceFlag } from './classify.js';
import { refineDocument } from './refine.js';

export interface IngestResult {
  document: ProductDocument;
  report: IngestReport;
  license: License;
}

export type Progress = (pct: number, message: string) => void;

export async function ingestPdf(data: Uint8Array, fileName: string, progress: Progress = () => {}): Promise<IngestResult> {
  const t0 = Date.now();
  progress(2, 'Reading PDF');
  const ex = await extractPdf(data, (d, n) => {
    if (d % 10 === 0 || d === n) progress(2 + Math.round((d / n) * 55), `Extracting text — page ${d} of ${n}`);
  });

  progress(58, 'Detecting table of contents, headers and footers');
  const clean = cleanPages(ex.pages);
  const { title, subtitle } = detectTitle(ex.pages, ex.meta.title);
  const scan = scanSource(ex.pages, ex.meta, clean.stripped, title);

  // Original cover: first page with very little text and the biggest type in the book → front matter.
  const sections: Section[] = [];
  const maxSize = Math.max(...ex.pages.flatMap((p) => p.lines.map((l) => l.size)));
  let pages = clean.pages;
  const firstPg = pages[0];
  if (firstPg && firstPg.page === 1 && firstPg.lines.length <= 18 && firstPg.lines.some((l) => l.size >= maxSize - 1)) {
    sections.push(makeSection('Original cover', 'front', [{ id: newId('b'), type: 'paragraph', text: firstPg.lines.map((l) => l.text).join(' / ') }], [1], 1));
    pages = pages.slice(1);
  }

  progress(62, 'Recovering structure');
  const stats = computeStats(pages.filter((p) => !isRecipePage(p)));
  let pending: ClassifiedLine[] = [];
  let lastRecipe: { section: Section; geometry: RecipeGeometry } | null = null;

  const flushGeneric = () => {
    if (!pending.length) return;
    const pageOf = new Map<string, number>();
    const blocks = linesToBlocks(demoteFalseHeadings(pending), stats, pageOf);
    sections.push(...splitSections(blocks, pageOf));
    pending = [];
  };

  for (const pg of pages) {
    const lines = pg.lines.filter((l) => !scan.junkLine(l.text));
    const page = { ...pg, lines };
    if (isRecipePage(page)) {
      flushGeneric();
      const r = parseRecipePage(page)!;
      const block: Block = {
        id: newId('b'),
        type: 'recipe',
        title: r.title,
        meta: Object.keys(r.meta).length ? r.meta : undefined,
        ingredients: r.ingredients,
        directions: r.directions,
      };
      const section = makeSection(r.title, 'recipe', [block], [pg.page], r.confidence);
      sections.push(section);
      lastRecipe = { section, geometry: r.geometry };
      continue;
    }
    if (lastRecipe && !pending.length && lines.length && lines.every((l) => (stats.bodySize ? l.size < stats.bodySize * 1.25 : true))) {
      // headerless page right after a recipe → overflow of that recipe
      const cont = parseRecipeContinuation(page, lastRecipe.geometry);
      const rb = lastRecipe.section.blocks[0] as Extract<Block, { type: 'recipe' }>;
      if (cont.ingredients.length || cont.directions.length) {
        rb.ingredients.push(...cont.ingredients);
        rb.directions.push(...cont.directions);
        lastRecipe.section.source.pages.push(pg.page);
        lastRecipe.section.confidence = Math.min(lastRecipe.section.confidence, 0.6);
        continue;
      }
    }
    lastRecipe = null;
    pending.push(...lines.map((l) => ({ ...l, kind: classifyLine(l, stats) })));
  }
  flushGeneric();
  sections.forEach((s, i) => (s.order = i));

  const productType = classifyProductType(sections);
  const document: ProductDocument = {
    title,
    subtitle,
    productType,
    deliverables: [{ id: newId('d'), kind: 'main', title, sections }],
  };

  const flags = [...scan.flags];
  const scraped = scrapedSourceFlag(sections);
  if (scraped) flags.push(scraped);
  if (clean.stripped.length) {
    flags.push({
      kind: 'stripped-header-footer',
      severity: 'info',
      message: `Removed ${clean.stripped.reduce((n, s) => n + s.count, 0)} running header/footer/page-number lines.`,
      sample: clean.stripped.slice(0, 4).map((s) => s.text).join(' | '),
    });
  }

  let aiRefined = false;
  let aiNotes: string[] = [];
  const refined = await refineDocument(document, progress).catch((e: Error) => {
    aiNotes = [`AI refine pass failed: ${e.message}`];
    return null;
  });
  if (refined) {
    aiRefined = refined.refinedSections > 0 || refined.notes.length > 0;
    aiNotes = refined.notes;
  }

  const content = sections.filter((s) => s.kind !== 'front');
  const low = content.filter((s) => s.confidence < 0.6);
  if (low.length) {
    flags.push({
      kind: 'low-confidence',
      severity: 'warn',
      message: `${low.length} section(s) have uncertain structure — review them in the viewer.`,
      pages: low.flatMap((s) => s.source.pages).slice(0, 40),
      sample: low.slice(0, 5).map((s) => s.title).join(' · '),
    });
  }

  const blockCounts: IngestReport['blockCounts'] = {};
  const countBlocks = (bs: Block[]) => {
    for (const b of bs) {
      blockCounts[b.type] = (blockCounts[b.type] ?? 0) + 1;
      if (b.type === 'callout') countBlocks(b.blocks);
    }
  };
  content.forEach((s) => countBlocks(s.blocks));

  const report: IngestReport = {
    sourceFileName: fileName,
    pageCount: ex.pageCount,
    pagesProcessed: ex.pages.length,
    tocPages: clean.tocPages,
    tocEntries: clean.tocEntries.slice(0, 1000),
    strippedLines: clean.stripped.slice(0, 30).map(({ text, count }) => ({ text, count })),
    sectionCount: content.length,
    blockCounts,
    avgConfidence: content.length ? Math.round((content.reduce((n, s) => n + s.confidence, 0) / content.length) * 100) / 100 : 0,
    flags,
    aiRefined,
    aiNotes,
    durationMs: Date.now() - t0,
  };
  progress(100, 'Ingest complete');
  return { document, report, license: scan.license };
}

function makeSection(title: string, kind: Section['kind'], blocks: Block[], pages: number[], confidence: number): Section {
  return { id: newId('s'), title, order: 0, kind, blocks, notes: [], lockedByUser: false, source: { pages }, confidence };
}

const PART_RE = /^part\s+([0-9]+|[ivx]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;

/** Split a block stream into sections at top-level headings. "PART n" headings become part sections. */
function splitSections(blocks: Block[], pageOf: Map<string, number>): Section[] {
  const hasH1 = blocks.some((b) => b.type === 'heading' && b.level === 1);
  const splitLevel = hasH1 ? 1 : 2;
  const out: Section[] = [];
  let cur: Section | null = null;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const isPart = b.type === 'heading' && PART_RE.test(b.text);
    if (b.type === 'heading' && (b.level <= splitLevel || isPart)) {
      let title = b.text;
      let kind: Section['kind'] = 'chapter';
      if (isPart) {
        kind = 'part';
        const nx = blocks[i + 1];
        if (nx?.type === 'heading') {
          title = `${title} — ${nx.text}`;
          i++;
        }
        cur = { id: newId('s'), title, order: 0, kind, blocks: [], notes: [], lockedByUser: false, source: { pages: [pageOf.get(b.id) ?? 0] }, confidence: 0.85 };
        out.push(cur);
        // a part opener's tagline often comes through as a heading — it's intro copy
        while (blocks[i + 1]?.type === 'heading' && (blocks[i + 1] as { level: number }).level > 1) {
          const h = blocks[++i] as Extract<Block, { type: 'heading' }>;
          cur.blocks.push({ id: h.id, type: 'paragraph', text: h.text });
        }
        continue;
      }
      cur = { id: newId('s'), title, order: 0, kind, blocks: [], notes: [], lockedByUser: false, source: { pages: [pageOf.get(b.id) ?? 0] }, confidence: 0.85 };
      out.push(cur);
      continue;
    }
    if (!cur) {
      cur = { id: newId('s'), title: 'Introduction', order: 0, kind: 'chapter', blocks: [], notes: [], lockedByUser: false, source: { pages: [] }, confidence: 0.75 };
      out.push(cur);
    }
    cur.blocks.push(b);
    const pg = pageOf.get(b.id);
    if (pg && !cur.source.pages.includes(pg)) cur.source.pages.push(pg);
  }
  for (const s of out) {
    if (s.kind === 'chapter' && s.blocks.length === 0) s.confidence = 0.4;
    // part openers usually carry one short paragraph (the part's promise) — that's expected
  }
  return out.filter((s) => s.blocks.length || s.kind === 'part');
}
