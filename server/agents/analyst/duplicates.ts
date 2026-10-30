// Duplicate finder. Two recipes are the same recipe when their ingredient lists overlap heavily
// (same name and ≥70% overlap, or any name and ≥85%). Same name but different recipe = a "same-name" group:
// both stay, and the Writer gives each a title that says what makes it different.
import type { Block, DuplicateGroup, Exclusion, ProductDocument, Section } from '../../../shared/types.js';

type Recipe = Extract<Block, { type: 'recipe' }>;

const STOP = new Set(
  'cup cups tablespoon tablespoons tbsp tsp teaspoon teaspoons pound pounds lbs ounce ounces can cans package packages pkg jar bottle large small medium chopped minced sliced diced fresh ground taste and the for into inch inches pieces piece cut finely thinly dried whole optional divided plus more about each clove cloves packed softened melted beaten room temperature trimmed cubed crushed grated shredded halved quartered peeled seeded drained rinsed thawed frozen prepared cooked uncooked hot cold warm extra virgin'.split(
    ' ',
  ),
);

export const normTitle = (t: string) =>
  t
    .toLowerCase()
    .replace(/®|™|\(r\)|\(tm\)/g, '')
    .replace(/\b(i{1,3}|iv|v|\d+)\s*$/i, '')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function ingredientTokens(r: Recipe): Set<string> {
  const out = new Set<string>();
  for (const line of r.ingredients) {
    if (/:$/.test(line.trim())) continue; // group label
    for (const w of line.toLowerCase().match(/[a-z]+/g) ?? []) if (w.length > 2 && !STOP.has(w)) out.add(w.replace(/(es|s)$/, ''));
  }
  return out;
}

const jaccard = (a: Set<string>, b: Set<string>) => {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
};

const recipeOf = (s: Section) => s.blocks.find((b): b is Recipe => b.type === 'recipe');

/** Higher = the better copy to keep: fuller ingredients and directions, cleaner structure, no brand in the title. */
function keepScore(s: Section) {
  const r = recipeOf(s)!;
  const brandTitle = /®|™/.test(s.title) ? -20 : 0;
  return r.ingredients.length * 2 + r.directions.join(' ').length / 80 + s.confidence * 5 + brandTitle;
}

export interface DuplicateResult {
  groups: DuplicateGroup[];
  excluded: Record<string, Exclusion>;
}

export function findDuplicates(doc: ProductDocument): DuplicateResult {
  const recipes = doc.deliverables
    .flatMap((d) => d.sections)
    .filter((s) => s.kind === 'recipe' && recipeOf(s))
    .map((s) => ({ s, title: normTitle(s.title), tokens: ingredientTokens(recipeOf(s)!) }));

  // Union-find over "same recipe" pairs.
  const parent = recipes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const sim = new Map<string, number>();
  for (let i = 0; i < recipes.length; i++) {
    for (let j = i + 1; j < recipes.length; j++) {
      const a = recipes[i];
      const b = recipes[j];
      if (a.tokens.size < 3 || b.tokens.size < 3) continue;
      const sameName = a.title === b.title && a.title.length > 0;
      if (!sameName && Math.abs(a.tokens.size - b.tokens.size) > Math.max(a.tokens.size, b.tokens.size) * 0.4) continue;
      const j2 = jaccard(a.tokens, b.tokens);
      if ((sameName && j2 >= 0.7) || j2 >= 0.85) {
        parent[find(i)] = find(j);
        sim.set(`${i}:${j}`, j2);
      }
    }
  }

  const clusters = new Map<number, number[]>();
  recipes.forEach((_, i) => {
    const r = find(i);
    clusters.set(r, [...(clusters.get(r) ?? []), i]);
  });

  const groups: DuplicateGroup[] = [];
  const excluded: Record<string, Exclusion> = {};
  let n = 0;
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => keepScore(recipes[b].s) - keepScore(recipes[a].s));
    const keep = recipes[sorted[0]].s;
    let best = 0;
    for (const [k, v] of sim) {
      const [a, b] = k.split(':').map(Number);
      if (members.includes(a) && members.includes(b)) best = Math.max(best, v);
    }
    groups.push({
      id: `dup${++n}`,
      kind: 'duplicate',
      sectionIds: sorted.map((i) => recipes[i].s.id),
      keepId: keep.id,
      similarity: Math.round(best * 100) / 100,
      titles: sorted.map((i) => recipes[i].s.title),
    });
    for (const i of sorted.slice(1)) {
      excluded[recipes[i].s.id] = { reason: 'duplicate', keptId: keep.id, note: `Same recipe as "${keep.title}" (${Math.round(best * 100)}% same ingredients)` };
    }
  }

  // Same name, different recipe (after removing true duplicates).
  const byName = new Map<string, number[]>();
  recipes.forEach((r, i) => {
    if (excluded[r.s.id] || !r.title) return;
    byName.set(r.title, [...(byName.get(r.title) ?? []), i]);
  });
  for (const [, members] of byName) {
    if (members.length < 2) continue;
    groups.push({
      id: `name${++n}`,
      kind: 'same-name',
      sectionIds: members.map((i) => recipes[i].s.id),
      keepId: recipes[members[0]].s.id,
      similarity: 0,
      titles: members.map((i) => recipes[i].s.title),
    });
  }
  return { groups, excluded };
}

/** For the Writer: what the other same-name recipes contain, so each gets a distinct title. */
export function sameNameNotes(doc: ProductDocument, groups: DuplicateGroup[]): Record<string, string> {
  const byId = new Map(doc.deliverables.flatMap((d) => d.sections).map((s) => [s.id, s]));
  const notes: Record<string, string> = {};
  for (const g of groups.filter((x) => x.kind === 'same-name')) {
    for (const id of g.sectionIds) {
      const others = g.sectionIds
        .filter((o) => o !== id)
        .map((o) => byId.get(o))
        .filter((s): s is Section => Boolean(s))
        .map((s) => {
          const r = recipeOf(s);
          return r ? r.ingredients.filter((i) => !/:$/.test(i.trim())).slice(0, 8).join('; ') : s.title;
        });
      if (others.length)
        notes[id] = `This book has ${others.length} other recipe${others.length > 1 ? 's' : ''} with the same name. Give this one a title that says what makes it different (its cut, method or key flavor) so the two are easy to tell apart. The other version${others.length > 1 ? 's use' : ' uses'}: ${others.map((o) => `[${o}]`).join(' ')}`;
    }
  }
  return notes;
}
