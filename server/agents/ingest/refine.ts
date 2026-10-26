// Optional Claude pass: fixes structure where the heuristics are unsure. Never rewrites wording.
// Runs only when ANTHROPIC_API_KEY is set. Cost is capped by REFINE_MAX_SECTIONS.
import Anthropic from '@anthropic-ai/sdk';
import type { Block, CalloutVariant, ProductDocument, Section } from '../../../shared/types.js';
import { config } from '../../config.js';
import { newId } from '../../util/ids.js';
import type { Progress } from './index.js';

const VARIANTS: CalloutVariant[] = ['tips', 'prompts', 'example', 'sample', 'note', 'generic'];
const nullable = (t: string) => ({ type: [t, 'null'] });
const strArr = { type: ['array', 'null'], items: { type: 'string' } };

const CHILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'text', 'ordered', 'items'],
  properties: {
    type: { type: 'string', enum: ['paragraph', 'list'] },
    text: nullable('string'),
    ordered: nullable('boolean'),
    items: strArr,
  },
};

const BLOCK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'level', 'text', 'label', 'variant', 'ordered', 'items', 'header', 'rows', 'children'],
  properties: {
    type: { type: 'string', enum: ['heading', 'paragraph', 'list', 'checklist', 'quote', 'callout', 'table'] },
    level: nullable('integer'),
    text: nullable('string'),
    label: nullable('string'),
    variant: { type: ['string', 'null'], enum: [...VARIANTS, null] },
    ordered: nullable('boolean'),
    items: strArr,
    header: strArr,
    rows: { type: ['array', 'null'], items: { type: 'array', items: { type: 'string' } } },
    children: { type: ['array', 'null'], items: CHILD_SCHEMA },
  },
};

const SECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'blocks', 'confidence'],
  properties: {
    title: { type: 'string' },
    blocks: { type: 'array', items: BLOCK_SCHEMA },
    confidence: { type: 'number' },
  },
};

const RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'ingredients', 'directions', 'confidence'],
  properties: {
    title: { type: 'string' },
    ingredients: { type: 'array', items: { type: 'string' } },
    directions: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
  },
};

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['notes'],
  properties: { notes: { type: 'array', items: { type: 'string' } } },
};

const SYSTEM = `You repair the STRUCTURE of text extracted from a PDF. You never rewrite, summarize, add or remove content.
Allowed: re-join lines that were broken by the PDF layout, undo hyphenation at line breaks, merge or split blocks so each block is one real paragraph / list / table / callout, fix block types and heading levels, fix ingredient lines that were wrapped into two items or merged into one.
Not allowed: changing wording, fixing grammar, improving style, dropping sentences, inventing text.
Set confidence 0..1 for how sure you are the result matches the original layout.`;

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
      return r.text ? { id, type: 'heading', level: (Math.min(3, Math.max(1, r.level ?? 2)) as 1 | 2 | 3), text: r.text } : null;
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
      const blocks: Block[] = [];
      for (const c of r.children ?? []) {
        if (c.type === 'list' && c.items?.length) blocks.push({ id: newId('b'), type: 'list', ordered: Boolean(c.ordered), items: c.items });
        else if (c.text) blocks.push({ id: newId('b'), type: 'paragraph', text: c.text });
      }
      if (!blocks.length && r.text) blocks.push({ id: newId('b'), type: 'paragraph', text: r.text });
      return { id, type: 'callout', variant: r.variant ?? 'generic', label: r.label ?? 'Note', blocks };
    }
    default:
      return null;
  }
}

async function callJson<T>(
  client: Anthropic,
  model: string,
  prompt: string,
  schema: object,
  maxTokens = 8000,
  system = SYSTEM,
): Promise<T> {
  const res = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: { type: 'json_schema', schema: schema as Record<string, unknown> } },
  });
  const text = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
  return JSON.parse(text) as T;
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

export async function refineDocument(doc: ProductDocument, progress: Progress) {
  if (!config.anthropicApiKey || config.refineMaxSections <= 0) return null;
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const sections: Section[] = doc.deliverables.flatMap((d) => d.sections).filter((s) => s.kind !== 'front');

  // Lowest confidence first, capped.
  const targets = [...sections]
    .filter((s) => s.confidence < config.refineBelowConfidence)
    .sort((a, b) => a.confidence - b.confidence)
    .slice(0, config.refineMaxSections);

  let done = 0;
  let refined = 0;
  const notes: string[] = [];
  await pool(targets, 4, async (s) => {
    try {
      if (s.kind === 'recipe' && s.blocks[0]?.type === 'recipe') {
        const r = s.blocks[0];
        const out = await callJson<{ title: string; ingredients: string[]; directions: string[]; confidence: number }>(
          client,
          config.ingestModel,
          `Fix this recipe's structure. Each ingredient must be one complete line; each direction one paragraph/step.\n\n${JSON.stringify({ title: r.title, ingredients: r.ingredients, directions: r.directions })}`,
          RECIPE_SCHEMA,
          4000,
        );
        s.blocks[0] = { ...r, title: out.title || r.title, ingredients: out.ingredients, directions: out.directions };
        s.title = s.blocks[0].title;
        s.confidence = Math.max(s.confidence, Math.min(0.95, out.confidence));
      } else {
        const out = await callJson<{ title: string; blocks: RawBlock[]; confidence: number }>(
          client,
          config.ingestModel,
          `Section title: ${s.title}\nCurrent blocks (JSON):\n${JSON.stringify(s.blocks)}`,
          SECTION_SCHEMA,
        );
        const blocks = out.blocks.map(toBlock).filter((b): b is Block => !!b);
        if (blocks.length) {
          s.blocks = blocks;
          s.title = out.title || s.title;
          s.confidence = Math.max(s.confidence, Math.min(0.95, out.confidence));
        }
      }
      refined++;
    } catch (e) {
      notes.push(`Refine skipped for "${s.title}": ${(e as Error).message.slice(0, 160)}`);
    }
    done++;
    progress(80 + Math.round((done / Math.max(1, targets.length)) * 15), `AI structure check — ${done} of ${targets.length} sections`);
  });

  // One cheap review call: what a human should look at before rewriting.
  try {
    const outline = sections.slice(0, 120).map((s) => `${s.kind}: ${s.title}`).join('\n');
    const sample = sections
      .slice(0, 3)
      .map((s) => JSON.stringify(s.blocks).slice(0, 2500))
      .join('\n');
    const review = await callJson<{ notes: string[] }>(
      client,
      config.reviewModel,
      `This is a PLR product being prepared for a full rewrite and redesign. Title: "${doc.title}". Detected type: ${doc.productType}.
Outline:\n${outline}\n\nSample content:\n${sample}\n
Give 3-6 short notes for the publisher: structural problems, content that looks outdated or thin, and anything that suggests the source was copied from elsewhere. Plain sentences, no markdown.`,
      REVIEW_SCHEMA,
      1500,
      'You are a senior editor at a publishing house reviewing source material before it is rewritten. Be specific and brief.',
    );
    notes.push(...review.notes);
  } catch (e) {
    notes.push(`AI review skipped: ${(e as Error).message.slice(0, 160)}`);
  }

  return { refinedSections: refined, notes };
}
