// Source-level checks: seller branding, URLs, trademarks, old copyright, license terms, product type.
import type { Block, IngestFlag, License, ProductType, Section } from '../../../shared/types.js';
import { emptyLicense } from '../../../shared/types.js';
import type { Line, PageLayout } from './extract.js';

export const URL_RE = /\b((https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|io|co|shop|store|us|uk|info|biz|me|app)(\/[^\s)]*)?)\b/i;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;
const TRADEMARK_RE = /([A-Z][\w'’&.-]*(?:\s[A-Z][\w'’&.-]*){0,2})\s?[®™]/g;
const COPYRIGHT_RE = /(©|\(c\)\s*\d{4}|copyright\s+(©\s*)?\d{4}|all rights reserved)/i;
const LICENSE_RE = /(private label rights|\bplr\b|master resell rights|\bmrr\b|resell rights|license terms|you (may|can|cannot|may not) (sell|resell|edit|give away|claim))/i;
const LICENSE_HEADING_RE = /^((plr|mrr|resell|private label)\s+)?(rights|license|licence)(\s+(terms|agreement|details))?:?$|^terms (of use|and conditions):?$/i;
const YES_NO_RE = /^\[?\s*(yes|no|x|✓|✔|✗)\s*\]?\s+(can|may|you)\b/i;
const AI_DISCLOSURE_RE = /(created|written|generated) (with|by|using) (the help of )?(ai|artificial intelligence)/i;
// Community recipe-site naming: "Round Steak and Gravy II", "Joel's Guinness Steak"
const SCRAPED_TITLE_RE = /(\s(I|II|III|IV)$)|(^[A-Z][a-z]+(-[A-Z][a-z]+)?'s\s)/;

const isDomainLike = (s: string | null) => !!s && /^[\w-]+(\.[\w-]+)+$/.test(s.trim());

export function detectTitle(pages: PageLayout[], metaTitle: string | null): { title: string; subtitle: string | null } {
  const first = pages[0];
  const lines = first ? [...first.lines].sort((a, b) => a.y - b.y) : [];
  if (lines.length) {
    const max = Math.max(...lines.map((l) => l.size));
    // Title = the run of large lines around the biggest type (e.g. "THE COMPLETE" + "AI MONEY-MAKING GUIDE").
    const iMax = lines.findIndex((l) => l.size === max);
    let a = iMax;
    let b = iMax;
    const big = (l: Line) => l.size >= max * 0.4 && !URL_RE.test(l.text);
    while (a > 0 && big(lines[a - 1]) && lines[a].y - lines[a - 1].y < lines[a].size * 2.5) a--;
    while (b < lines.length - 1 && lines[b + 1].size >= max * 0.9 && lines[b + 1].y - lines[b].y < lines[b + 1].size * 2.5) b++;
    const title = lines.slice(a, b + 1).map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim();
    // Subtitle = the next lines of medium type that read like a phrase (no stats lines, URLs, seller names).
    const sub: Line[] = [];
    for (let i = b + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.size < max * 0.3 || URL_RE.test(l.text) || /[•|]/.test(l.text)) break;
      if (sub.length && (Math.abs(l.size - sub[0].size) > 0.6 || l.y - sub[sub.length - 1].y > l.size * 2.2)) break;
      sub.push(l);
    }
    const subtitle = sub.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim();
    if (title && title.length <= 140) {
      return { title: tidyTitle(title), subtitle: subtitle && subtitle.split(' ').length >= 2 ? subtitle : null };
    }
  }
  if (metaTitle && !isDomainLike(metaTitle) && !/anonymous|untitled|microsoft word/i.test(metaTitle)) {
    return { title: metaTitle, subtitle: null };
  }
  return { title: 'Untitled', subtitle: null };
}

function tidyTitle(t: string) {
  // "THE COMPLETE AI MONEY-MAKING GUIDE" → keep caps words like AI, title-case the rest
  if (t === t.toUpperCase()) {
    return t
      .toLowerCase()
      .replace(/(^|[\s\-—–/(])([a-z])/g, (_, p, c) => p + c.toUpperCase())
      .replace(/\b(Ai|Seo|Plr|Diy|Usa)\b/g, (m) => m.toUpperCase());
  }
  return t;
}

export interface SourceScan {
  flags: IngestFlag[];
  sellerNames: string[];
  junkLine: (text: string) => boolean;
  license: License;
}

export function scanSource(
  allPages: PageLayout[],
  meta: { title: string | null; producer: string | null; creator: string | null },
  stripped: { text: string; count: number; pages: number[] }[],
  bookTitle: string,
): SourceScan {
  const flags: IngestFlag[] = [];
  const lines: Line[] = allPages.flatMap((p) => p.lines);

  // Seller names: running-header text that isn't the book title, plus domain-like metadata titles.
  const titleNorm = bookTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
  const sellerNames = new Set<string>();
  for (const s of stripped) {
    if (s.text === '[page number]') continue;
    for (const part of s.text.split(/\s{3,}/)) {
      const n = part.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!n || n.length < 4 || titleNorm.includes(n) || n.includes(titleNorm)) continue;
      if (/^part\d/.test(n) || /^chapter\d/.test(n)) continue;
      if (part.split(' ').length <= 4) sellerNames.add(part.trim());
    }
  }
  if (isDomainLike(meta.title)) sellerNames.add(meta.title!.trim());
  const sellerList = [...sellerNames];

  if (sellerList.length) {
    flags.push({
      kind: 'seller-branding',
      severity: 'warn',
      message: `Original seller branding found and removed from the content: ${sellerList.join(', ')}`,
      sample: sellerList[0],
    });
  }

  const urlLines = lines.filter((l) => URL_RE.test(l.text) || EMAIL_RE.test(l.text));
  if (urlLines.length) {
    const uniq = [...new Set(urlLines.map((l) => (l.text.match(URL_RE) ?? l.text.match(EMAIL_RE))![0].toLowerCase()))];
    flags.push({
      kind: 'url',
      severity: 'warn',
      message: `${uniq.length} URL/email reference(s) found — links to the original seller are removed; other links need review.`,
      pages: [...new Set(urlLines.map((l) => l.page))].slice(0, 30),
      sample: uniq.slice(0, 5).join(', '),
    });
  }

  const tm = new Map<string, number>();
  for (const l of lines) for (const m of l.text.matchAll(TRADEMARK_RE)) tm.set(m[1].trim(), (tm.get(m[1].trim()) ?? 0) + 1);
  if (tm.size) {
    const top = [...tm.entries()].sort((a, b) => b[1] - a[1]);
    flags.push({
      kind: 'trademark',
      severity: 'info',
      message: `${top.length} trademarked brand name(s) referenced (${top.reduce((n, [, c]) => n + c, 0)} times). The rewrite should use generic terms.`,
      sample: top.slice(0, 6).map(([k, c]) => `${k} ×${c}`).join(', '),
    });
  }

  const cr = lines.filter((l) => COPYRIGHT_RE.test(l.text));
  if (cr.length) {
    flags.push({
      kind: 'copyright-notice',
      severity: 'info',
      message: 'Original copyright notice found — replaced by the Empire Maker imprint page at render.',
      pages: [...new Set(cr.map((l) => l.page))],
      sample: cr[0].text.slice(0, 120),
    });
  }

  const ai = lines.find((l) => AI_DISCLOSURE_RE.test(l.text));
  if (ai) {
    flags.push({
      kind: 'ai-disclosure',
      severity: 'info',
      message: 'Source says it was created with AI. Check each marketplace’s AI-content disclosure rules before listing.',
      pages: [ai.page],
      sample: ai.text.slice(0, 140),
    });
  }

  // License terms: pages with several license phrases.
  const license = emptyLicense();
  const licScore = (p: PageLayout) => {
    let score = 0;
    for (const l of p.lines) {
      const t = l.text.trim();
      if (LICENSE_HEADING_RE.test(t)) score += 3;
      if (YES_NO_RE.test(t)) score += 1;
      if (LICENSE_RE.test(t)) score += 1;
    }
    return score;
  };
  const licPages = allPages.filter((p) => licScore(p) >= 5);
  if (licPages.length) {
    // Kept for reference only (no gate): any rights/terms pages found in the source.
    license.status = 'detected';
    license.rawTerms = licPages
      .map((p) => p.lines.map((l) => l.text).join('\n'))
      .join('\n\n')
      .slice(0, 8000);
  }

  const sellerNorms = sellerList.map((s) => s.toLowerCase());
  const junkLine = (text: string) => {
    const t = text.toLowerCase();
    if (sellerNorms.some((s) => t.includes(s))) return true;
    const onlyUrl = text.replace(URL_RE, '').replace(EMAIL_RE, '').replace(/[\s|•·:,-]/g, '');
    if ((URL_RE.test(text) || EMAIL_RE.test(text)) && onlyUrl.length < 4) return true;
    return false;
  };

  return { flags, sellerNames: sellerList, junkLine, license };
}

export function scrapedSourceFlag(sections: Section[]): IngestFlag | null {
  const titles = sections.filter((s) => s.kind === 'recipe').map((s) => s.title);
  const hits = titles.filter((t) => SCRAPED_TITLE_RE.test(t));
  if (titles.length >= 20 && hits.length >= Math.max(5, titles.length * 0.03)) {
    return {
      kind: 'scraped-source',
      severity: 'warn',
      message: `${hits.length} recipe titles follow community recipe-site naming (numbered variants, personal names). The content may have been copied from a recipe site. Ingredient lists are generally reusable; the directions text must be fully rewritten in your own words before sale.`,
      sample: hits.slice(0, 6).join(' · '),
    };
  }
  return null;
}

export function classifyProductType(sections: Section[]): ProductType {
  const all: Block[] = sections.flatMap((s) => s.blocks);
  const count = (t: Block['type']) => all.filter((b) => b.type === t).length;
  const recipes = count('recipe');
  if (recipes >= 5 && recipes >= sections.length * 0.4) return 'cookbook';
  const fill = count('fillIn') + count('checklist');
  if (fill >= 10 && fill >= all.length * 0.2) return 'workbook';
  const headings = all.filter((b) => b.type === 'heading').map((b) => (b as { text: string }).text);
  if (headings.filter((h) => /\b(module|lesson|week)\s*\d+/i.test(h)).length >= 3 && headings.some((h) => /module|lesson/i.test(h)))
    return 'course';
  if (headings.filter((h) => /(monday|january|daily|weekly|monthly)\b/i.test(h)).length >= 6) return 'planner';
  return 'ebook';
}
