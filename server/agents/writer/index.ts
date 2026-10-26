// Agent 2 — Writer. Rewrites a product section by section in a persona's voice.
// Per section: draft → lint (copy check + banned phrases) → targeted revision if it fails → flag if still failing.
// Then a rebrand pass: title options + back-cover copy.
import type {
  Block,
  CalloutVariant,
  Persona,
  ProductDocument,
  PublisherBrand,
  Section,
  SectionWriteResult,
  WriterReport,
  WriterSettings,
} from '../../../shared/types.js';
import { config } from '../../config.js';
import { addUsage, emptyUsage, type Llm } from '../../llm.js';
import { newId } from '../../util/ids.js';
import { REBRAND_SCHEMA, RECIPE_SCHEMA, SECTION_SCHEMA, writerSystem } from './prompts.js';
import { bannedHits, copyCheck } from './similarity.js';
import { beefScope } from './scope.js';

type RecipeBlock = Extract<Block, { type: 'recipe' }>;

// Canned soup, seasoning packets and similar shortcuts — the "convenience" decision applies to these.
const CONVENIENCE_RE = /condensed|cream of (mushroom|chicken|celery)|soup mix|onion soup|gravy mix|seasoning (mix|packet)|packet|envelope|\bcan(ned)? .*soup/i;
export const isConvenienceRecipe = (r: RecipeBlock) => r.ingredients.some((i) => CONVENIENCE_RE.test(i));

export interface WriteOptions {
  llm: Llm;
  persona: Persona;
  brand: PublisherBrand;
  source: ProductDocument;
  existingDraft: ProductDocument | null;
  settings: WriterSettings;
  progress: (pct: number, message: string) => void | Promise<void>;
  cancelled?: () => boolean;
  concurrency?: number;
}

export interface WriteOutput {
  draft: ProductDocument;
  report: WriterReport;
}

const blockText = (b: Block): string => {
  switch (b.type) {
    case 'heading':
    case 'paragraph':
    case 'quote':
      return b.text;
    case 'list':
    case 'checklist':
      return b.items.join(' ');
    case 'callout':
      return [b.label, ...b.blocks.map(blockText)].join(' ');
    case 'table':
      return [...(b.header ?? []), ...b.rows.flat()].join(' ');
    case 'recipe':
      return [b.headnote ?? '', ...b.directions, ...(b.tips ?? [])].join(' ');
    case 'fillIn':
      return b.prompt;
    case 'imageSlot':
      return b.description;
  }
};
const sectionText = (s: Section) => s.blocks.map(blockText).join('\n');

type RawChild = { type: 'paragraph' | 'list'; text: string | null; ordered: boolean | null; items: string[] | null };
type RawBlock = {
  type: string;
  level: number | null;
  text: string | null;
  label: string | null;
  variant: CalloutVariant | null;
  ordered: boolean | null;
  items: string[] | null;
  header: string[] | null;
  rows: string[][] | null;
  children: RawChild[] | null;
};

function toBlock(r: RawBlock): Block | null {
  const id = newId('b');
  switch (r.type) {
    case 'heading':
      return r.text ? { id, type: 'heading', level: Math.min(3, Math.max(1, r.level ?? 2)) as 1 | 2 | 3, text: r.text } : null;
    case 'paragraph':
      return r.text ? { id, type: 'paragraph', text: r.text } : null;
    case 'quote':
      return r.text ? { id, type: 'quote', text: r.text } : null;
    case 'list':
      return r.items?.length ? { id, type: 'list', ordered: Boolean(r.ordered), items: r.items } : null;
    case 'checklist':
      return r.items?.length ? { id, type: 'checklist', items: r.items } : null;
    case 'table':
      return r.rows?.length ? { id, type: 'table', header: r.header?.length ? r.header : null, rows: r.rows } : null;
    case 'callout': {
      const blocks: Block[] = (r.children ?? [])
        .map((c): Block | null =>
          c.type === 'list' && c.items?.length
            ? { id: newId('b'), type: 'list', ordered: Boolean(c.ordered), items: c.items }
            : c.text
              ? { id: newId('b'), type: 'paragraph', text: c.text }
              : null,
        )
        .filter((b): b is Block => !!b);
      if (!blocks.length && r.text) blocks.push({ id: newId('b'), type: 'paragraph', text: r.text });
      return blocks.length ? { id, type: 'callout', variant: r.variant ?? 'generic', label: r.label ?? 'Note', blocks } : null;
    }
    default:
      return null;
  }
}

async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

export async function writeProduct(o: WriteOptions): Promise<WriteOutput> {
  const startedAt = new Date().toISOString();
  const usage = emptyUsage();
  const system = writerSystem(o.persona, o.brand, o.source.productType);
  const model = config.writerModel;
  const minT = o.settings.minTransformation;

  // Draft starts from the previous draft (runs are cumulative), else from the source.
  const draft: ProductDocument = structuredClone(o.existingDraft ?? o.source);
  const draftSections = draft.deliverables[0].sections;

  let targets = o.source.deliverables
    .flatMap((d) => d.sections)
    .filter((s) => s.kind !== 'front' && s.kind !== 'back');
  if (o.settings.sectionIds?.length) targets = targets.filter((s) => o.settings.sectionIds!.includes(s.id));
  if (o.settings.limit) targets = targets.slice(0, o.settings.limit);

  const outline = o.source.deliverables[0].sections
    .filter((s) => s.kind !== 'front')
    .map((s) => s.title)
    .slice(0, 150);
  const results: SectionWriteResult[] = [];
  const cut = new Set<string>();
  let done = 0;

  await pool(targets, o.concurrency ?? 4, async (src) => {
    if (o.cancelled?.()) return;
    const existing = draftSections.find((s) => s.id === src.id);
    const res: SectionWriteResult = { sectionId: src.id, title: src.title, status: 'written', transformation: null, bannedHits: [], attempts: 0, notes: [] };
    try {
      if (existing?.lockedByUser) {
        res.status = 'skipped';
        res.notes.push('Locked — edited by hand.');
      } else if (src.kind === 'recipe' && src.blocks[0]?.type === 'recipe') {
        const r = src.blocks[0];
        const convenience = isConvenienceRecipe(r);
        const scope = o.settings.scope === 'beef' ? beefScope(r) : { keep: true, reason: '' };
        if (!scope.keep) {
          res.status = 'cut';
          res.notes.push(`Out of scope — ${scope.reason}.`);
          cut.add(src.id);
        } else if (convenience && o.settings.convenience === 'cut') {
          res.status = 'cut';
          res.notes.push('Built on canned soup / seasoning packets — cut per settings.');
          cut.add(src.id);
        } else {
          const out = await writeRecipe(o, system, model, r, convenience, minT, res, usage);
          replaceSection(draftSections, src, { ...src, title: out.title, blocks: [out, ...src.blocks.slice(1)] });
        }
      } else {
        const out = await writeSection(o, system, model, src, outline, minT, res, usage);
        replaceSection(draftSections, src, out);
      }
    } catch (e) {
      res.status = 'failed';
      res.notes.push((e as Error).message.slice(0, 300));
    }
    results.push(res);
    done++;
    await o.progress(5 + (done / Math.max(1, targets.length)) * 85, `Writing — ${done} of ${targets.length}: ${src.title}`);
  });

  draft.deliverables[0].sections = draftSections.filter((s) => !cut.has(s.id));
  draft.deliverables[0].sections.forEach((s, i) => (s.order = i));

  // Rebrand pass: title options and back-cover copy, from the (re)written outline.
  if (!o.cancelled?.()) {
    await o.progress(92, 'Writing title options and back-cover copy');
    try {
      const sample = draft.deliverables[0].sections
        .filter((s) => s.kind !== 'front')
        .slice(0, 6)
        .map((s) => `## ${s.title}\n${sectionText(s).slice(0, 900)}`)
        .join('\n\n');
      const { data, usage: u } = await o.llm.json<{ titleOptions: { title: string; subtitle: string }[]; backCover: { headline: string; blurb: string; bullets: string[] } }>({
        model,
        system,
        maxTokens: 2500,
        schema: REBRAND_SCHEMA,
        prompt: `Write the rebrand pack for this ${o.source.productType}.
Current working title: "${o.source.title}"${o.source.subtitle ? ` — "${o.source.subtitle}"` : ''}
Sections (${draft.deliverables[0].sections.length}): ${draft.deliverables[0].sections.slice(0, 60).map((s) => s.title).join(' | ')}

Opening content:
${sample}

Return:
- titleOptions: 5 options. Title max 6 words, subtitle max 14 words, specific promise, no hype words. None may reuse the source title's wording.
- backCover: headline (max 12 words), blurb (60–90 words, in the voice, no invented facts or numbers beyond what the book contains), bullets (exactly 4, max 10 words each, concrete things the reader gets).`,
      });
      addUsage(usage, u);
      if (data.titleOptions[0]) {
        draft.titleOptions = data.titleOptions.slice(0, 5);
        draft.title = data.titleOptions[0].title;
        draft.subtitle = data.titleOptions[0].subtitle;
      }
      draft.backCover = { headline: data.backCover.headline, blurb: data.backCover.blurb, bullets: data.backCover.bullets.slice(0, 4) };
    } catch (e) {
      results.push({ sectionId: '_rebrand', title: 'Title + back cover', status: 'failed', transformation: null, bannedHits: [], attempts: 1, notes: [(e as Error).message.slice(0, 300)] });
    }
  }

  const scored = results.filter((r) => r.transformation !== null);
  return {
    draft,
    report: {
      personaId: o.persona.id,
      personaName: o.persona.name,
      settings: o.settings,
      startedAt,
      finishedAt: new Date().toISOString(),
      sections: results.sort((a, b) => order(o.source, a.sectionId) - order(o.source, b.sectionId)),
      avgTransformation: scored.length ? scored.reduce((n, r) => n + (r.transformation ?? 0), 0) / scored.length : null,
      usage,
    },
  };

  function order(doc: ProductDocument, id: string) {
    const i = doc.deliverables[0].sections.findIndex((s) => s.id === id);
    return i < 0 ? 1e9 : i;
  }
}

function replaceSection(list: Section[], src: Section, next: Section) {
  const i = list.findIndex((s) => s.id === src.id);
  const value: Section = { ...next, id: src.id, notes: next.notes ?? [], lockedByUser: false };
  if (i >= 0) list[i] = value;
  else list.push(value);
}

async function writeRecipe(
  o: WriteOptions,
  system: string,
  model: string,
  r: RecipeBlock,
  convenience: boolean,
  minT: number,
  res: SectionWriteResult,
  usage: ReturnType<typeof emptyUsage>,
): Promise<RecipeBlock> {
  const sourceText = r.directions.join(' ');
  const mode = !convenience
    ? 'Rewrite this recipe in the house voice. You may improve technique where it clearly helps (a doneness cue, a better searing step), keeping it the same dish.'
    : o.settings.convenience === 'upgrade'
      ? 'This recipe relies on canned soup or seasoning packets. UPGRADE it: replace each convenience product with a simple from-scratch equivalent (a quick roux sauce, a spice blend), keep it the same dish, and keep total effort reasonable.'
      : 'This recipe relies on canned soup or seasoning packets. KEEP the shortcut (use generic names) and own it honestly in the headnote as a convenience recipe.';
  let feedback = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    res.attempts = attempt;
    const { data, usage: u } = await o.llm.json<{ title: string; headnote: string; ingredients: string[]; directions: string[]; tips: string[]; changeNotes: string[] }>({
      model,
      system,
      maxTokens: 3000,
      schema: RECIPE_SCHEMA,
      prompt: `${mode}
Give it a new descriptive title (no numbering like "II", no personal names). Ingredients: keep quantities accurate, one ingredient per line, generic names. Steps: numbered in the output array, each with a doneness cue where one applies. Tips: 0–2 items, each starting "Why it works:" or "Make it better:". changeNotes: what you changed for the publisher (1–3 short items).
${feedback}
SOURCE RECIPE:
${JSON.stringify({ title: r.title, ingredients: r.ingredients, directions: r.directions, meta: r.meta ?? null })}`,
    });
    addUsage(usage, u);
    const out: RecipeBlock = {
      id: r.id,
      type: 'recipe',
      title: data.title.trim(),
      headnote: data.headnote.trim(),
      meta: r.meta,
      ingredients: data.ingredients.map((s) => s.trim()).filter(Boolean),
      directions: data.directions.map((s) => s.replace(/^(step\s*)?\d+[.)]\s*/i, '').trim()).filter(Boolean),
      tips: data.tips.map((s) => s.trim()).filter(Boolean).slice(0, 2),
    };
    const written = [out.headnote, ...out.directions, ...(out.tips ?? [])].join(' ');
    const c = copyCheck(sourceText, out.directions.join(' '));
    const banned = bannedHits(written + ' ' + out.title, o.persona.bannedPhrases);
    res.transformation = c.transformation;
    res.bannedHits = banned;
    res.notes = data.changeNotes.slice(0, 3);
    if (c.transformation >= minT && !banned.length) return out;
    feedback = `\nYOUR PREVIOUS ATTEMPT FAILED REVIEW:${c.transformation < minT ? `\n- Too close to the source (${Math.round(c.transformation * 100)}% new wording; need ${Math.round(minT * 100)}%). Reword these copied phrases completely: ${c.copiedPhrases.slice(0, 8).map((p) => `"${p}"`).join(', ')}` : ''}${banned.length ? `\n- Remove banned words: ${banned.join(', ')}` : ''}\n`;
    if (attempt === 3) {
      res.status = 'flagged';
      res.notes.push(`Still ${Math.round(c.transformation * 100)}% new after 3 attempts${banned.length ? `; banned words: ${banned.join(', ')}` : ''} — review by hand.`);
      return out;
    }
  }
  throw new Error('unreachable');
}

async function writeSection(
  o: WriteOptions,
  system: string,
  model: string,
  src: Section,
  outline: string[],
  minT: number,
  res: SectionWriteResult,
  usage: ReturnType<typeof emptyUsage>,
): Promise<Section> {
  const sourceText = sectionText(src);
  const idx = outline.indexOf(src.title);
  let feedback = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    res.attempts = attempt;
    const { data, usage: u } = await o.llm.json<{ title: string; blocks: RawBlock[]; changeNotes: string[] }>({
      model,
      system,
      maxTokens: 8000,
      schema: SECTION_SCHEMA,
      prompt: `Rewrite this ${src.kind === 'part' ? 'part opener' : 'chapter'} of "${o.source.title}" in the house voice.
Where it sits: ${idx > 0 ? `after "${outline[idx - 1]}"` : 'near the start'}${idx >= 0 && outline[idx + 1] ? `, before "${outline[idx + 1]}"` : ''}.
Keep every useful idea, step, prompt and list item; you may reorder, merge or split for clarity, sharpen vague advice into concrete steps, and add one short callout if it genuinely helps. Keep callout labels short (e.g. "Quick Tips", "Try This Prompt"). Copy-paste prompts must stay usable prompts with their [placeholders]. Give the section a fresh title (max 9 words). changeNotes: 1–3 short items for the publisher.
${src.kind === 'part' ? 'A part opener is short: one or two sentences that set up the part.' : ''}${feedback}
SOURCE SECTION:
${JSON.stringify({ title: src.title, blocks: src.blocks })}`,
    });
    addUsage(usage, u);
    const blocks = data.blocks.map(toBlock).filter((b): b is Block => !!b);
    const next: Section = { ...src, title: data.title.trim() || src.title, blocks, confidence: 1 };
    const written = sectionText(next);
    const c = copyCheck(sourceText, written);
    const banned = bannedHits(written + ' ' + next.title, o.persona.bannedPhrases);
    res.transformation = c.transformation;
    res.bannedHits = banned;
    res.notes = data.changeNotes.slice(0, 3);
    // Prompts the reader copies are allowed to stay close to the source; judge on everything else.
    if ((c.transformation >= minT || written.length < 200) && !banned.length && blocks.length) return next;
    feedback = `\n\nYOUR PREVIOUS ATTEMPT FAILED REVIEW:${c.transformation < minT ? `\n- Too close to the source (${Math.round(c.transformation * 100)}% new wording; need ${Math.round(minT * 100)}%). Reword these copied phrases completely: ${c.copiedPhrases.slice(0, 10).map((p) => `"${p}"`).join(', ')}` : ''}${banned.length ? `\n- Remove banned words: ${banned.join(', ')}` : ''}${!blocks.length ? '\n- You returned no content blocks.' : ''}`;
    if (attempt === 3) {
      res.status = 'flagged';
      res.notes.push(`Still ${Math.round(c.transformation * 100)}% new after 3 attempts — review by hand.`);
      return next;
    }
  }
  throw new Error('unreachable');
}

/** Rough token estimate for a run, before spending anything. ~4 chars per token. */
export function estimateRun(source: ProductDocument, settings: WriterSettings, persona: Persona, brand: PublisherBrand) {
  let targets = source.deliverables.flatMap((d) => d.sections).filter((s) => s.kind !== 'front' && s.kind !== 'back');
  if (settings.sectionIds?.length) targets = targets.filter((s) => settings.sectionIds!.includes(s.id));
  if (settings.limit) targets = targets.slice(0, settings.limit);
  const systemTokens = Math.ceil(writerSystem(persona, brand, source.productType).length / 4);
  let input = 0;
  let output = 0;
  let cut = 0;
  for (const s of targets) {
    const r = s.blocks[0];
    if (r?.type === 'recipe' && ((settings.scope === 'beef' && !beefScope(r).keep) || (settings.convenience === 'cut' && isConvenienceRecipe(r)))) {
      cut++;
      continue;
    }
    const chars = JSON.stringify(s.blocks).length;
    input += Math.ceil(chars / 4) + 400;
    output += Math.ceil((chars / 4) * 1.3) + 200;
  }
  const retryFactor = 1.15; // some sections need a second attempt
  const calls = Math.round((targets.length - cut) * retryFactor) + 1;
  return {
    sections: targets.length,
    cut,
    calls,
    cachedSystemTokens: systemTokens,
    inputTokens: Math.round(input * retryFactor),
    outputTokens: Math.round(output * retryFactor),
    convenienceRecipes: targets.filter((s) => s.blocks[0]?.type === 'recipe' && isConvenienceRecipe(s.blocks[0] as RecipeBlock)).length,
    outOfScope: settings.scope === 'beef' ? targets.filter((s) => s.blocks[0]?.type === 'recipe' && !beefScope(s.blocks[0] as RecipeBlock).keep).length : 0,
  };
}
