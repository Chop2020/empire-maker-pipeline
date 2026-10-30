// Prompt + schema building for the Writer. The system prompt is identical for every call in a run,
// so it gets cached: persona, house rules and examples are paid for once.
import type { Persona, ProductType, PublisherBrand } from '../../../shared/types.js';
import { PRESET_TONES } from '../../../shared/types.js';

const pct = (v: number) => Math.round(v * 100);

function sliderWords(p: Persona) {
  const s = p.sliders;
  const scale = (v: number, lo: string, mid: string, hi: string) => (v < 0.34 ? lo : v < 0.67 ? mid : hi);
  return [
    `Formality: ${scale(s.formality, 'loose and casual', 'relaxed but polished', 'formal')} (${pct(s.formality)}/100)`,
    `Humor: ${scale(s.humor, 'rare', 'regular, dry', 'frequent')} (${pct(s.humor)}/100)`,
    `Sentence length: ${scale(s.sentenceLength, 'short and punchy', 'mixed long and short', 'long and flowing')} (${pct(s.sentenceLength)}/100)`,
    `Opinion strength: ${scale(s.opinion, 'neutral', 'clear preferences', 'strong, decisive opinions')} (${pct(s.opinion)}/100)`,
    `Reading level: about US grade ${s.readingLevel}`,
  ].join('\n');
}

export function writerSystem(p: Persona, brand: PublisherBrand, productType: ProductType): string {
  const presets = p.presets.map((id) => PRESET_TONES.find((t) => t.id === id)).filter(Boolean);
  const examples = (p.examples ?? []).slice(0, 3);
  return `You are the Writer for ${brand.name}. You turn private-label source material into an original ${brand.name} ${productType} written in one consistent house voice.

# The voice: ${p.name}
${p.description}

Tone presets: ${presets.map((t) => `${t!.label} (${t!.hint})`).join('; ') || 'none'}
${sliderWords(p)}

Traits:
${Object.entries(p.traits).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

Signature moves (use naturally, never all at once):
${p.signatureMoves.map((m) => `- ${m}`).join('\n')}

Never use these words or phrases: ${p.bannedPhrases.join(', ')}.

Voice rules:
${p.rules.map((r) => `- ${r}`).join('\n')}
${p.recipeFormat ? `\nRecipe format:\n- Headnote: ${p.recipeFormat.headnote}\n- Steps: ${p.recipeFormat.steps}\n- Optional extras: ${p.recipeFormat.extras.join('; ')}` : ''}
${p.inspiration ? `\nThe voice is modeled on the style traits of a published writer. Use the traits only: never reuse that writer's sentences or signature lines, never name them, never imply they are involved.` : ''}

# House rules (always)
1. Rewrite completely in your own words. Do not copy sentences or distinctive phrases from the source. Keep its useful substance: every instruction, quantity, temperature, time and genuine fact.
2. Never invent facts: no statistics, studies, quotes, prices, credentials or personal history. Stories and examples must read as illustrations ("Picture a freelancer who…"), never as reported real cases with made-up results. If the source presents a made-up-sounding case with numbers, recast it as an illustration without the numbers.
3. Replace brand and trademark names with generic terms: anything marked ® or ™ and any branded product (a brand of soup, sauce, seasoning, beer or soda) becomes its generic name ("condensed cream of mushroom soup", "hot pepper sauce", "Irish stout").
3b. Never name restaurants, chefs, TV cooks, websites or the people who submitted a recipe. Remove any credits, "submitted by" lines, usernames and web addresses. Titles describe the dish, never a person ("Joy's Pepper Steak" → "Skillet Pepper Steak with Sweet Onions").
4. Food safety: ground meat to 160°F; poultry to 165°F; keep any doneness temperature you state within standard practice.
5. Never mention the source, the original seller, PLR, or that this was rewritten.
6. Return only what the JSON schema asks for.
${examples.length ? `\n# Approved examples of this voice\n${examples.map((e, i) => `Example ${i + 1} (${e.mode}):\nSOURCE: ${JSON.stringify(e.source)}\nREWRITE: ${JSON.stringify(e.rewrite)}`).join('\n\n')}` : ''}`;
}

// ---------- schemas ----------

const nullable = (t: string) => ({ type: [t, 'null'] });
const strArr = { type: ['array', 'null'], items: { type: 'string' } };

export const RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'headnote', 'ingredients', 'directions', 'tips', 'changeNotes'],
  properties: {
    title: { type: 'string' },
    headnote: { type: 'string' },
    ingredients: { type: 'array', items: { type: 'string' } },
    directions: { type: 'array', items: { type: 'string' } },
    tips: { type: 'array', items: { type: 'string' } },
    changeNotes: { type: 'array', items: { type: 'string' } },
  },
};

const CHILD = {
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

export const SECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'blocks', 'changeNotes'],
  properties: {
    title: { type: 'string' },
    changeNotes: { type: 'array', items: { type: 'string' } },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'level', 'text', 'label', 'variant', 'ordered', 'items', 'header', 'rows', 'children'],
        properties: {
          type: { type: 'string', enum: ['heading', 'paragraph', 'list', 'checklist', 'quote', 'callout', 'table'] },
          level: nullable('integer'),
          text: nullable('string'),
          label: nullable('string'),
          variant: { type: ['string', 'null'], enum: ['tips', 'prompts', 'example', 'sample', 'note', 'generic', null] },
          ordered: nullable('boolean'),
          items: strArr,
          header: strArr,
          rows: { type: ['array', 'null'], items: { type: 'array', items: { type: 'string' } } },
          children: { type: ['array', 'null'], items: CHILD },
        },
      },
    },
  },
};

export const REBRAND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['titleOptions', 'backCover'],
  properties: {
    titleOptions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'subtitle'],
        properties: { title: { type: 'string' }, subtitle: { type: 'string' } },
      },
    },
    backCover: {
      type: 'object',
      additionalProperties: false,
      required: ['headline', 'blurb', 'bullets'],
      properties: {
        headline: { type: 'string' },
        blurb: { type: 'string' },
        bullets: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};
