// Transformation check: how much of the rewrite is new wording vs. copied from the source.
// Word n-gram overlap — cheap, deterministic, and it tells the model exactly which phrases to change.

const tokenize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9½¼¾°]+/g, ' ')
    .split(' ')
    .filter(Boolean);

export interface CopyCheck {
  transformation: number; // 0..1, share of the rewrite's n-grams NOT found in the source
  copiedPhrases: string[]; // longest copied runs, for feedback
}

export function copyCheck(source: string, rewrite: string, n = 5): CopyCheck {
  const s = tokenize(source);
  const r = tokenize(rewrite);
  if (r.length < n || s.length < n) return { transformation: 1, copiedPhrases: [] };
  const grams = new Set<string>();
  for (let i = 0; i + n <= s.length; i++) grams.add(s.slice(i, i + n).join(' '));
  const hit: boolean[] = [];
  let hits = 0;
  for (let i = 0; i + n <= r.length; i++) {
    const h = grams.has(r.slice(i, i + n).join(' '));
    hit.push(h);
    if (h) hits++;
  }
  // Rebuild copied runs as phrases.
  const phrases: string[] = [];
  let i = 0;
  while (i < hit.length) {
    if (!hit[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < hit.length && hit[j + 1]) j++;
    phrases.push(r.slice(i, j + n).join(' '));
    i = j + 1;
  }
  phrases.sort((a, b) => b.length - a.length);
  return { transformation: 1 - hits / hit.length, copiedPhrases: phrases.slice(0, 12) };
}

export function bannedHits(text: string, banned: string[]): string[] {
  const t = text.toLowerCase();
  return banned.filter((b) => b.trim() && t.includes(b.toLowerCase()));
}
