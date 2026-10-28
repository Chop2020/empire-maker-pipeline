// Image Director: Claude turns a recipe / chapter / the whole book into one photo prompt.
// The product's style bible is appended to every prompt, so a whole book reads as one photo shoot.
import type { Block, ProductDocument, Section } from '../../../shared/types.js';
import type { Llm, Usage } from '../../llm.js';
import { emptyUsage } from '../../llm.js';

type Recipe = Extract<Block, { type: 'recipe' }>;

export interface ShotBrief {
  kind: 'cover' | 'hero' | 'opener';
  title: string;
  context: string; // what the model gets to read
}

export const DIRECTOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['prompt', 'alt'],
  properties: {
    prompt: { type: 'string', description: 'The photo description for the image model, 60–120 words, no style boilerplate.' },
    alt: { type: 'string', description: 'One-sentence alt text describing the photo.' },
  },
} as const;

export function directorSystem(styleText: string) {
  return `You are the food photography art director for a cookbook publisher. For each request you write ONE prompt for a photorealistic image model.

Goal: a photo that makes the reader hungry and matches the recipe exactly, so a buyer who cooks it recognizes the dish.

Rules for the subject:
- Show the finished dish from the recipe: the actual cut of meat, how it was cooked, how it is cut and served. Only show ingredients, sauces and sides that are in the recipe. Never invent a side dish.
- Steaks and roasts cooked hot and fast: show them sliced against the grain with a rosy medium-rare center, a dark crust and resting juices, unless the recipe says otherwise.
- Braises, stews, pot roasts, chili: fork-tender meat in glossy sauce, in the pot or a wide bowl.
- Sandwiches, burgers, tacos, wraps: cut or open so the filling shows, held together, never collapsing.
- Sauces, rubs, marinades, butters: show them in use — spooned over or melting on sliced steak, or in a small bowl next to it with the raw ingredients that define them.
- Pick the camera angle that suits the dish: about 45 degrees for plated or sliced meat, overhead for bowls, boards and spreads, straight on for burgers and stacked sandwiches.
- Add one or two garnishes or props drawn from the recipe's own ingredients (fresh herbs, a lemon half, cracked pepper, a few raw peppers) for color contrast. Keep it simple and natural.
- Appetite cues: glistening, juicy, caramelized, steaming, sizzling edges, melting butter, a drip of sauce. Fill the frame with food.
- Never: people, hands, faces, text, labels, logos, packaging, brand names, cartoon or illustration styles, raw meat as the hero (unless it is a rub or marinade shot).

Write the prompt as a plain description of the photograph, starting with the subject. Concrete nouns, no hype words like "delicious" or "mouth-watering", no camera brand names. 60–120 words. Do NOT restate the style below — it is appended automatically.

House style for this book (for consistency of surfaces, light and mood):
${styleText}`;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

export function recipeBrief(section: Section): ShotBrief {
  const r = section.blocks.find((b): b is Recipe => b.type === 'recipe');
  const lines = [`RECIPE: ${section.title}`];
  if (r?.headnote) lines.push(`Headnote: ${clip(r.headnote, 500)}`);
  if (r) {
    lines.push(`Ingredients:\n- ${r.ingredients.join('\n- ')}`);
    lines.push(`Directions:\n${r.directions.map((d, i) => `${i + 1}. ${clip(d, 300)}`).join('\n')}`);
  } else {
    lines.push(clip(section.blocks.map((b) => ('text' in b ? b.text : '')).join('\n'), 1500));
  }
  return { kind: 'hero', title: section.title, context: `Write the hero photo for this recipe. The image is wide (about 2:1) and sits across the top of the recipe page.\n\n${lines.join('\n\n')}` };
}

export function openerBrief(section: Section, following: Section[]): ShotBrief {
  const text = section.blocks
    .map((b) => (b.type === 'paragraph' || b.type === 'heading' ? b.text : b.type === 'list' ? b.items.join('; ') : ''))
    .filter(Boolean)
    .join('\n');
  const recipes = following.filter((s) => s.kind === 'recipe').slice(0, 15).map((s) => s.title);
  return {
    kind: 'opener',
    title: section.title,
    context:
      `Write a full-page chapter-opener photo for the chapter "${section.title}". It is portrait (about 4:5). The chapter title is printed over the TOP third, so keep the top third dark and simple (deep shadow, out-of-focus background) and put the food in the lower two thirds. ` +
      `It should set the mood for the whole chapter rather than illustrate one recipe — for example a spread of several of its dishes, or the signature dish with its key ingredients around it.\n\n` +
      (text ? `Chapter text:\n${clip(text, 1500)}\n\n` : '') +
      (recipes.length ? `Recipes in this chapter:\n- ${recipes.join('\n- ')}` : ''),
  };
}

export function coverBrief(doc: ProductDocument): ShotBrief {
  const sections = doc.deliverables.flatMap((d) => d.sections).filter((s) => s.kind === 'recipe');
  const titles = sections.slice(0, 60).map((s) => s.title);
  return {
    kind: 'cover',
    title: doc.title,
    context:
      `Write the front-cover photo for the cookbook "${doc.title}"${doc.subtitle ? ` — ${doc.subtitle}` : ''}. Portrait (about 4:5). ` +
      `The title is printed over the TOP 40% and the author name at the bottom edge, so keep the top 40% dark and uncluttered and place the food in the middle-to-lower part of the frame. ` +
      `Pick the single most iconic, crave-worthy dish this book promises (for a steak book: a thick steak, seared dark, sliced to show the center) — one hero subject, not a spread.\n\n` +
      (doc.backCover ? `Back-cover pitch: ${doc.backCover.headline} ${doc.backCover.blurb}\n\n` : '') +
      `Some recipes inside:\n- ${titles.join('\n- ')}`,
  };
}

/** Prompt without an LLM (no ANTHROPIC_API_KEY): serviceable, less specific. */
export function fallbackPrompt(b: ShotBrief): { prompt: string; alt: string } {
  const what = b.kind === 'cover' ? `A thick seared steak sliced to show a rosy center, the hero of a cookbook cover titled ${b.title}` : `${b.title}, the finished dish, plated and ready to eat`;
  return { prompt: `${what}. Close-up, food fills the frame, glistening and freshly cooked.`, alt: b.title };
}

export async function directShot(llm: Llm | null, model: string, styleText: string, brief: ShotBrief): Promise<{ prompt: string; alt: string; usage: Usage }> {
  if (!llm) return { ...fallbackPrompt(brief), usage: emptyUsage() };
  const { data, usage } = await llm.json<{ prompt: string; alt: string }>({
    model,
    system: directorSystem(styleText),
    prompt: brief.context,
    schema: DIRECTOR_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 800,
  });
  return { prompt: data.prompt.trim(), alt: data.alt.trim(), usage };
}

export const withStyle = (prompt: string, styleText: string) => `${prompt.trim()}\n\n${styleText.trim()}`;
