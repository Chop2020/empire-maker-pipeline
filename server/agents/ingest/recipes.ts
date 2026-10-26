// Recipe pages: "Ingredients" + "Directions" headers, side-by-side columns or stacked.
import type { Line, PageLayout, TextItem } from './extract.js';

const ING_RE = /^ingredients:?$/i;
const DIR_RE = /^(directions|instructions|method|preparation|steps):?$/i;
const META_RE = /^(servings|serves|yield|makes|prep(\s*time)?|cook(\s*time)?|total(\s*time)?|ready in)\s*[:\-]/i;
// A new ingredient usually starts with a quantity or a "to taste" staple.
const ITEM_START_RE =
  /^([\d½¼¾⅓⅔⅛⅜⅝⅞]|a\s|an\s|one\s|two\s|three\s|four\s|six\s|pinch|dash|salt|pepper|kosher|sea salt|cooking spray|water|ice\b|juice of|zest of)/i;
const JOIN_WORD_END_RE = /(,|\band|\bor|\bof|\bwith|\bin|\bfor|\bto|-)$/i;
// A line ending on one of these words can't be a complete ingredient — the next line finishes it.
export const DANGLING_END_RE =
  /(,|-|\b(and|or|of|with|in|for|to|into|the|a|an|about|cut|black|white|red|green|yellow|ground|freshly|fresh|large|small|medium|finely|coarsely|cubed|plus|bell|sweet|hot|cayenne|chile|chili))$|\binto (thin|thick)$/i;

export interface RecipeGeometry {
  ingX: number;
  dirX: number;
  sideBySide: boolean;
}

export interface ParsedRecipe {
  title: string;
  meta: { servings?: string; prepTime?: string; cookTime?: string };
  ingredients: string[];
  directions: string[];
  geometry: RecipeGeometry;
  confidence: number;
}

interface ColLine {
  text: string;
  x0: number;
  x1: number;
  y: number;
  size: number;
}

function findHeader(lines: Line[], re: RegExp) {
  for (const l of lines) {
    for (const s of l.segments) if (re.test(s.text.trim())) return { line: l, x: s.x0, y: l.y };
  }
  return null;
}

export function isRecipePage(pg: PageLayout): boolean {
  return Boolean(findHeader(pg.lines, ING_RE) && findHeader(pg.lines, DIR_RE));
}

function toColLine(items: TextItem[]): ColLine | null {
  const its = items.filter((i) => i.str.trim()).sort((a, b) => a.x - b.x);
  if (!its.length) return null;
  let text = '';
  let end = -Infinity;
  for (const i of its) {
    const gap = i.x - end;
    text += (text && gap > 0.15 * i.size && !/\s$/.test(text) ? ' ' : '') + i.str;
    end = Math.max(end, i.x + i.w);
  }
  return {
    text: text.replace(/\s+/g, ' ').trim(),
    x0: its[0].x,
    x1: end,
    y: its[0].y,
    size: Math.max(...its.map((i) => i.size)),
  };
}

function splitColumns(lines: Line[], g: RecipeGeometry) {
  const left: ColLine[] = [];
  const right: ColLine[] = [];
  for (const l of lines) {
    const li = toColLine(l.items.filter((i) => i.x < g.dirX - 4));
    const ri = toColLine(l.items.filter((i) => i.x >= g.dirX - 4));
    if (li) left.push(li);
    if (ri) right.push(ri);
  }
  return { left, right };
}

export function joinIngredients(lines: ColLine[], colLeft: number, colRight: number): string[] {
  const out: string[] = [];
  const width = Math.max(40, colRight - colLeft);
  let prev: ColLine | null = null;
  for (const l of lines) {
    const t = l.text.replace(/^[•\-–▪●◦]\s*/, '');
    if (!t) continue;
    const prevRatio = prev ? (prev.x1 - colLeft) / width : 0;
    const gap = prev ? l.y - prev.y : Infinity;
    const tight = gap < l.size * 1.9;
    const looksNew = ITEM_START_RE.test(t);
    const prevText = out[out.length - 1] ?? '';
    const groupLabel = /:$/.test(t) || /:$/.test(prevText.trim()); // "MARINADE:" style sub-lists
    const fragment = /^\(.*\)$/.test(t) || (t.split(' ').length <= 2 && !looksNew && !/to taste/i.test(t));
    const dangling = prev !== null && !groupLabel && (DANGLING_END_RE.test(prevText.trim()) || fragment);
    const continuation =
      prev !== null &&
      tight &&
      !groupLabel &&
      (dangling ||
        (!looksNew && (prevRatio > 0.62 || JOIN_WORD_END_RE.test(prevText) || (/^[a-z]/.test(t) && prevRatio > 0.45))));
    if (continuation) out[out.length - 1] = `${prevText} ${t}`.replace(/(\w)- (\w)/g, '$1-$2');
    else out.push(t);
    prev = l;
  }
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export function joinParagraphs(lines: ColLine[]): string[] {
  if (!lines.length) return [];
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i].y - lines[i - 1].y);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? lines[0].size * 1.2;
  const paras: string[] = [];
  let cur = '';
  lines.forEach((l, i) => {
    const t = l.text.replace(/^(step\s*)?\d+[.)]\s+/i, '');
    if (i > 0 && gaps[i - 1] > Math.max(median * 1.45, l.size * 1.6)) {
      if (cur) paras.push(cur);
      cur = t;
    } else if (/^(step\s*)?\d+[.)]\s+/i.test(l.text) && cur) {
      paras.push(cur);
      cur = t;
    } else {
      cur = cur ? (/[a-z]-$/i.test(cur) ? cur.slice(0, -1) + t : `${cur} ${t}`) : t;
    }
  });
  if (cur) paras.push(cur);
  return paras.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export function parseRecipePage(pg: PageLayout): ParsedRecipe | null {
  const ing = findHeader(pg.lines, ING_RE);
  const dir = findHeader(pg.lines, DIR_RE);
  if (!ing || !dir) return null;

  const headerY = Math.min(ing.y, dir.y);
  const sideBySide = dir.x > ing.x + 60 && Math.abs(dir.y - ing.y) < 30;
  const geometry: RecipeGeometry = { ingX: ing.x, dirX: dir.x, sideBySide };

  const above = pg.lines.filter((l) => l.y < headerY - 2);
  const meta: ParsedRecipe['meta'] = {};
  const titleLines: Line[] = [];
  for (const l of above) {
    const m = l.text.match(META_RE);
    if (m) {
      const val = l.text.slice(m[0].length).trim();
      const k = m[1].toLowerCase();
      if (/serv|yield|makes/.test(k)) meta.servings = val;
      else if (/prep/.test(k)) meta.prepTime = val;
      else if (/cook|total|ready/.test(k)) meta.cookTime = val;
    } else titleLines.push(l);
  }
  const maxSize = Math.max(0, ...titleLines.map((l) => l.size));
  const title = titleLines
    .filter((l) => l.size >= maxSize - 0.5)
    .map((l) => l.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const body = pg.lines.filter((l) => l !== ing.line && l !== dir.line && l.y > headerY + 2);
  let ingredients: string[];
  let directions: string[];
  if (sideBySide) {
    const { left, right } = splitColumns(body, geometry);
    ingredients = joinIngredients(left, ing.x, dir.x - 6);
    directions = joinParagraphs(right);
  } else {
    const [first, second] = ing.y < dir.y ? [ing, dir] : [dir, ing];
    const block1 = body.filter((l) => l.y < second.y).map((l) => toColLine(l.items)!).filter(Boolean);
    const block2 = body.filter((l) => l.y > second.y + 2).map((l) => toColLine(l.items)!).filter(Boolean);
    const right = Math.max(...pg.lines.map((l) => l.x1));
    const ingLines = first === ing ? block1 : block2;
    const dirLines = first === ing ? block2 : block1;
    ingredients = joinIngredients(ingLines, ing.x, right);
    directions = joinParagraphs(dirLines);
  }

  let confidence = 0.9;
  if (!title) confidence -= 0.3;
  if (ingredients.length < 2) confidence -= 0.3;
  if (!directions.length) confidence -= 0.3;
  if (ingredients.some((i) => i.length > 120)) confidence -= 0.2;
  if (ingredients.some((i) => DANGLING_END_RE.test(i.trim()) || i.split(' ').length <= 1)) confidence -= 0.25;
  return { title: title || 'Untitled recipe', meta, ingredients, directions, geometry, confidence: Math.max(0.1, confidence) };
}

/** A page with no recipe headers that continues the previous recipe's columns. */
export function parseRecipeContinuation(pg: PageLayout, g: RecipeGeometry) {
  if (!g.sideBySide) return { ingredients: [] as string[], directions: joinParagraphs(pg.lines.map((l) => toColLine(l.items)!).filter(Boolean)) };
  const { left, right } = splitColumns(pg.lines, g);
  return { ingredients: joinIngredients(left, g.ingX, g.dirX - 6), directions: joinParagraphs(right) };
}
