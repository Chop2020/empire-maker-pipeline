// Persona builder: research an author's or copywriter's style on the web (and/or from pasted samples)
// and turn it into a Persona — measurable traits, never their sentences.
import type { Persona, PresetTone } from '../../../shared/types.js';
import { PRESET_TONES } from '../../../shared/types.js';
import { config } from '../../config.js';
import type { Llm, Usage } from '../../llm.js';
import { addUsage, emptyUsage } from '../../llm.js';

const PERSONA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'description', 'presets', 'sliders', 'traits', 'signatureMoves', 'bannedPhrases', 'rules'],
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    presets: { type: 'array', items: { type: 'string', enum: PRESET_TONES.map((t) => t.id) } },
    sliders: {
      type: 'object',
      additionalProperties: false,
      required: ['formality', 'humor', 'sentenceLength', 'readingLevel', 'opinion'],
      properties: {
        formality: { type: 'number' },
        humor: { type: 'number' },
        sentenceLength: { type: 'number' },
        readingLevel: { type: 'integer' },
        opinion: { type: 'number' },
      },
    },
    traits: {
      type: 'object',
      additionalProperties: false,
      required: ['stance', 'humor', 'rhythm', 'structure', 'vocabulary', 'address', 'persuasion'],
      properties: {
        stance: { type: 'string' },
        humor: { type: 'string' },
        rhythm: { type: 'string' },
        structure: { type: 'string' },
        vocabulary: { type: 'string' },
        address: { type: 'string' },
        persuasion: { type: 'string' },
      },
    },
    signatureMoves: { type: 'array', items: { type: 'string' } },
    bannedPhrases: { type: 'array', items: { type: 'string' } },
    rules: { type: 'array', items: { type: 'string' } },
  },
};

const BASE_BANNED = ['game-changer', 'elevate', 'look no further', "in today's fast-paced world", 'unlock the secrets', 'delve'];
const BASE_RULES = [
  'Never fabricate personal experiences, credentials, statistics or quotes.',
  'Never reproduce sentences or signature lines from the inspiration writer, never name them, never imply they are involved.',
];

export async function researchPersona(
  llm: Llm,
  input: { authorName?: string; samples?: string; notes?: string },
  onProgress: (pct: number, msg: string) => void | Promise<void>,
): Promise<{ persona: Omit<Persona, 'id'>; sources: string[]; usage: Usage }> {
  const usage = emptyUsage();
  let research = '';
  let sources: string[] = [];

  if (input.authorName) {
    await onProgress(10, `Researching ${input.authorName}'s style`);
    const r = await llm.research({
      model: config.personaModel,
      system:
        'You are a literary analyst who profiles writing styles for a publishing house. Use web search to find reviews, interviews, author pages and short excerpts. Report observable, reusable style traits. Quote at most a few words at a time; describe, do not reproduce.',
      prompt: `Profile the writing style of ${input.authorName}.
Cover: overall stance and what they care about; humor (kind, frequency); sentence and paragraph rhythm; how a typical piece is structured (openings, middles, endings); vocabulary and imagery; how they address the reader; how they persuade or explain; recurring signature moves; what they would never write.
${input.notes ? `Publisher's notes: ${input.notes}` : ''}
Finish with a compact bullet summary of the traits.`,
      maxSearches: 8,
    });
    addUsage(usage, r.usage);
    research = r.text;
    sources = r.sources;
  }

  await onProgress(65, 'Turning research into a persona');
  const { data, usage: u } = await llm.json<Omit<Persona, 'id' | 'inspiration' | 'examples' | 'builtIn'> & { presets: PresetTone[] }>({
    model: config.personaModel,
    system:
      'You convert style research into a reusable writing persona for a publishing house. Describe traits a writer can apply to any topic. Sliders are 0..1 except readingLevel (US grade 4–16). The persona name must be an evocative descriptor, never the inspiration writer\'s name.',
    maxTokens: 3000,
    schema: PERSONA_SCHEMA,
    prompt: `${input.authorName ? `Inspiration writer: ${input.authorName}\n\nResearch notes:\n${research}\n\n` : ''}${input.samples ? `Writing samples the publisher owns (analyze style only):\n"""\n${input.samples.slice(0, 30000)}\n"""\n\n` : ''}${input.notes ? `Publisher's notes: ${input.notes}\n\n` : ''}Build the persona. signatureMoves: 4–6 items. bannedPhrases: hype or cliché phrases this voice would never use (6–12). rules: 2–5 voice-specific rules.`,
  });
  addUsage(usage, u);

  const persona: Omit<Persona, 'id'> = {
    ...data,
    sliders: {
      formality: clamp01(data.sliders.formality),
      humor: clamp01(data.sliders.humor),
      sentenceLength: clamp01(data.sliders.sentenceLength),
      opinion: clamp01(data.sliders.opinion),
      readingLevel: Math.min(16, Math.max(4, Math.round(data.sliders.readingLevel))),
    },
    bannedPhrases: [...new Set([...data.bannedPhrases, ...BASE_BANNED])],
    rules: [...new Set([...BASE_RULES, ...data.rules])],
    inspiration: input.authorName
      ? { note: 'Style traits only. Never reuse their sentences or name them on a product.', source: input.authorName }
      : undefined,
  };
  await onProgress(100, 'Persona ready');
  return { persona, sources, usage };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5));

/** A persona from presets + sliders alone (no AI). Traits come from the preset hints. */
export function personaFromPresets(name: string, presets: PresetTone[], sliders: Persona['sliders'], base?: Persona): Omit<Persona, 'id'> {
  const hints = presets.map((p) => PRESET_TONES.find((t) => t.id === p)!).filter(Boolean);
  if (base) {
    return {
      ...structuredClone(base),
      name,
      description: `${base.name}, adjusted: ${hints.map((h) => h.label.toLowerCase()).join(', ') || 'custom sliders'}.`,
      presets: [...new Set([...base.presets, ...presets])],
      sliders,
      builtIn: false,
    };
  }
  return {
    name,
    description: hints.map((h) => h.hint).join('. ') || 'Custom voice.',
    presets,
    sliders,
    traits: Object.fromEntries(hints.map((h) => [h.id, h.hint])),
    signatureMoves: ['Lead with the reader’s problem', 'End each section on one concrete next step'],
    bannedPhrases: BASE_BANNED,
    rules: BASE_RULES.slice(0, 1),
  };
}
