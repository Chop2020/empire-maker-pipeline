// Clearance scan: what in the book could get a listing pulled or draw a copyright / trademark complaint.
// Copyright protects the wording of directions, headnotes and stories (not ingredient lists), so any section
// still in the source wording is the big risk. Brand, restaurant and chef names are trademark risks.
// This is a risk screen, not legal advice.
import type { Block, ClearanceItem, ClearanceKind, ClearanceReport, ProductDocument, Section, WriterReport } from '../../../shared/types.js';

const BRANDS = [
  "Campbell'?s",
  'Swanson',
  'Knorr',
  'Lipton',
  'Kraft',
  'Heinz',
  'A\\.?1(?= (?:steak )?sauce)',
  'Lea ?(?:&|and) ?Perrins',
  'Velveeta',
  'Old El Paso',
  'McCormick',
  "Lawry'?s",
  'Mrs\\.? Dash',
  'Tabasco',
  "Frank'?s Red ?Hot",
  "Sweet Baby Ray'?s",
  "Newman'?s Own",
  'Best Foods',
  "Hellmann'?s",
  'Miracle Whip',
  "French'?s",
  'Grey Poupon',
  'Kikkoman',
  'La Choy',
  'Wish-?Bone',
  "Hunt'?s",
  'Del Monte',
  'Green Giant',
  'Ortega',
  "Bush'?s",
  'Pace(?= (?:picante|salsa|chunky))',
  'Prego',
  'Ragu',
  'Bertolli',
  'Goya',
  'Sazon Goya',
  'Crisco',
  'SPLENDA',
  'Splenda',
  'Sargento',
  'Morton(?= (?:Tender ?Quick|salt|kosher))',
  'Tender ?Quick',
  "Smucker'?s",
  'V8',
  "Ac'?cent",
  'Kitchen Bouquet',
  'Gravy Master',
  'SPAM',
  'Morningstar Farms',
  'Marzetti',
  'Corona',
  'Budweiser',
  'Guinness',
  "Jack Daniel'?s",
  'Coca-?Cola',
  'Coke',
  'Dr\\.? ?Pepper',
  'Pepsi',
  '7-?Up',
  'Sprite',
  'Ro-?Tel',
  'Rotel',
  'Bisquick',
  'Pillsbury',
  'Hidden Valley',
  "Shake ?'?n'? ?Bake",
  'Stove Top',
  "Uncle Ben'?s",
  'Minute Rice',
  'Cool Whip',
  'Jell-?O',
  'Ziploc',
  'Reynolds Wrap',
  'Crock-?Pot',
  'Kingsford',
  'Philadelphia(?= cream cheese)',
  "Dale'?s(?= (?:steak )?seasoning| sauce)",
  'Allegro(?= marinade)',
  "Tony Chachere'?s",
  "Zatarain'?s",
  'Maggi',
  'Better Than Bouillon',
  'Wondra',
  'Montreal Steak Seasoning',
  "Cook'?s(?=®)",
];
const BRAND_SRC = `\\b(${BRANDS.join('|')})(?![a-z])`;
const BRAND_RE = new RegExp(BRAND_SRC, 'g');
const BRAND_TEST = new RegExp(BRAND_SRC);
const LEAD_WORDS = /^((?:Add|Combine|Stir|Mix|Use|Pour|Place|Top|Season|Serve|Sprinkle|Brush|Whisk|Heat|In|With|Or|And|The|Then|Soup or)\s+(?:in\s+)?)+/;
const MARK_RE = /([A-Z][\w'&.-]*(?: [A-Z][\w'&.-]*){0,3})\s*(®|™|\(R\)|\(TM\))/g;

const RESTAURANTS =
  /\b(Outback|Texas Roadhouse|Ruth'?s Chris|LongHorn|Applebee'?s|Olive Garden|P\.? ?F\.? Chang'?s|Panda Express|Chili'?s|KFC|Cracker Barrel|Red Lobster|T\.?G\.?I\.? Friday'?s|Benihana|Peter Luger|Arby'?s|McDonald'?s|Wendy'?s|Burger King|Taco Bell|Chipotle Mexican Grill|Copy ?cat)\b/i;
const VENUE = /\b(cafe|café|restaurant|diner|tavern|bistro|bar & grill|eatery|chophouse)\b/i;
const CHEFS =
  /\b(Emeril|Paula Deen|Bobby Flay|Gordon Ramsay|Martha Stewart|Ina Garten|Barefoot Contessa|Rachael Ray|Guy Fieri|Julia Child|Alton Brown|Pioneer Woman|Ree Drummond|Wolfgang Puck|Jamie Oliver|Nigella|Mario Batali|Giada|Bourdain|Aaron Franklin|Kenji|L[oó]pez-Alt|Thomas Keller|Jacques P[eé]pin|Morimoto|Schatzker|Meathead|Rick Bayless|Bobby Deen|Sandra Lee|Food Network)\b/i;
const ATTRIBUTION = /(submitted by|recipe (?:by|from|courtesy)|courtesy of|from the kitchen of|adapted from|photo (?:by|credit)|allrecipes|food\.com|taste of home|recipezaar|genius kitchen|epicurious|bon app[eé]tit|www\.|https?:\/\/|\.com\b)/i;
const GENERIC_POSSESSIVE = /^(devil|chef|shepherd|hunter|farmer|cowboy|butcher|baker|miner|fisherman|sailor|pirate|king|queen|bachelor|lover|poor man|working man|cook)'s\s/i;
const PERSONAL_TITLE = /^([A-Z][a-z]+(?:-[A-Z][a-z]+)?|Mom-Mom|Mom|Dad|Granny|Grandma|Grandpa|Nana|Papa|Mama|Aunt [A-Z][a-z]+|Uncle [A-Z][a-z]+)'s\s/;
const NUMBERED_TITLE = /\s(I{1,3}|IV|V)$/;

export function sectionText(s: Section): string {
  const out: string[] = [];
  const walk = (b: Block) => {
    if (b.type === 'recipe') out.push(b.headnote ?? '', ...b.ingredients, ...b.directions, ...(b.tips ?? []));
    else if (b.type === 'paragraph' || b.type === 'heading' || b.type === 'quote') out.push(b.text);
    else if (b.type === 'list' || b.type === 'checklist') out.push(...b.items);
    else if (b.type === 'callout') b.blocks.forEach(walk);
    else if (b.type === 'table') out.push(...(b.header ?? []), ...b.rows.flat());
    else if (b.type === 'fillIn') out.push(b.prompt);
  };
  s.blocks.forEach(walk);
  return out.join('\n');
}

const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()))].filter(Boolean);

export function clearance(doc: ProductDocument, basis: 'draft' | 'source', report: WriterReport | null, excluded: Set<string>): ClearanceReport {
  const sections = doc.deliverables.flatMap((d) => d.sections).filter((s) => s.kind !== 'front' && s.kind !== 'back' && !excluded.has(s.id));
  const results = new Map((report?.sections ?? []).map((r) => [r.sectionId, r]));
  const items: ClearanceItem[] = [];
  const add = (s: Section, kind: ClearanceKind, severity: ClearanceItem['severity'], detail: string) => items.push({ sectionId: s.id, title: s.title, kind, severity, detail });
  let rewritten = 0;

  for (const s of sections) {
    const r = results.get(s.id);
    const done = basis === 'draft' && r && (r.status === 'written' || r.status === 'skipped' || r.status === 'flagged');
    if (done) rewritten++;
    if (basis === 'source' || !r || r.status === 'failed' || r.status === 'cut') {
      if (!(basis === 'draft' && s.lockedByUser)) add(s, 'not-rewritten', 'high', 'Directions and text are still the source wording.');
    } else if (r.status === 'flagged' && !s.lockedByUser) {
      add(s, 'low-new-wording', 'high', r.notes.find((n) => /new after/.test(n)) ?? 'The rewrite stayed too close to the source.');
    }

    const text = `${s.title}\n${sectionText(s)}`;
    const marked = [...text.matchAll(MARK_RE)].map((m) => m[1].replace(LEAD_WORDS, ''));
    const brands = uniq([...text.matchAll(BRAND_RE)].map((m) => m[1]).concat(marked));
    if (/®|™|\(R\)|\(TM\)/.test(s.title) || BRAND_TEST.test(s.title)) {
      add(s, 'sponsored-recipe', 'high', `Brand name in the title (often a manufacturer's promo recipe). Needs a new title.`);
    }
    if (brands.length) add(s, 'brand', 'medium', `Replace with generic names: ${brands.slice(0, 6).join(', ')}`);

    const rest = text.match(RESTAURANTS)?.[0] ?? (VENUE.test(s.title) ? s.title : null);
    if (rest) add(s, 'restaurant-or-chef', 'high', `Restaurant name: ${rest}`);
    const chef = text.match(CHEFS)?.[0];
    if (chef) add(s, 'restaurant-or-chef', 'high', `Chef / TV personality name: ${chef}`);

    const att = text.match(ATTRIBUTION)?.[0];
    if (att) add(s, 'attribution', 'high', `Credit or website mention: "${att}"`);

    if (!GENERIC_POSSESSIVE.test(s.title) && (PERSONAL_TITLE.test(s.title) || NUMBERED_TITLE.test(s.title))) {
      add(s, 'recipe-site-title', 'medium', 'Personal name or numbered title, typical of recipe-sharing sites. Give it a descriptive title.');
    }
    if (s.blocks.some((b) => b.type === 'quote')) add(s, 'quote', 'medium', 'Contains a quotation — make sure it is not from a copyrighted book, song or poem.');
  }

  const counts: ClearanceReport['counts'] = {};
  for (const i of items) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
  return { basis, sections: sections.length, rewritten, items, counts, ready: !items.some((i) => i.severity === 'high') };
}

/** Per-section notes for the Writer, so a rewrite also clears the risks found. */
export function clearanceNotes(rep: ClearanceReport): Record<string, string> {
  const by: Record<string, string[]> = {};
  for (const i of rep.items) {
    if (i.kind === 'not-rewritten' || i.kind === 'low-new-wording') continue;
    (by[i.sectionId] ??= []).push(i.detail);
  }
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, `Clearance fixes needed: ${v.join(' ')}`]));
}

