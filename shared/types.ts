// Shared document model — the contract every agent reads and writes.
// Agents never pass raw text to each other; they pass a ProductDocument.

export type ProductType = 'ebook' | 'cookbook' | 'workbook' | 'planner' | 'course';

export type CalloutVariant = 'tips' | 'prompts' | 'example' | 'sample' | 'note' | 'generic';

export type Block =
  | { id: string; type: 'heading'; level: 1 | 2 | 3; text: string }
  | { id: string; type: 'paragraph'; text: string }
  | { id: string; type: 'list'; ordered: boolean; items: string[] }
  | { id: string; type: 'quote'; text: string; cite?: string }
  | { id: string; type: 'callout'; variant: CalloutVariant; label: string; blocks: Block[] }
  | { id: string; type: 'table'; header: string[] | null; rows: string[][] }
  | {
      id: string;
      type: 'recipe';
      title: string;
      headnote?: string;
      meta?: { servings?: string; prepTime?: string; cookTime?: string };
      ingredients: string[];
      directions: string[];
      tips?: string[]; // "Why it works", "Make it better"
    }
  | { id: string; type: 'checklist'; items: string[] }
  | { id: string; type: 'fillIn'; prompt: string; lines: number }
  | { id: string; type: 'imageSlot'; description: string; assetKey?: string };

export type BlockType = Block['type'];

export interface UpgradeNote {
  id: string;
  kind: 'outdated' | 'gap' | 'thin' | 'filler' | 'restructure' | 'visual';
  text: string;
}

export interface Section {
  id: string;
  title: string;
  order: number;
  kind: 'front' | 'chapter' | 'part' | 'recipe' | 'back';
  blocks: Block[];
  notes: UpgradeNote[];
  lockedByUser: boolean;
  source: { pages: number[] };
  confidence: number; // 0..1 — how sure ingest is about the structure of this section
}

export interface Deliverable {
  id: string;
  kind: 'main' | 'workbook' | 'module' | 'bonus' | 'checklist';
  title: string;
  sections: Section[];
}

export interface License {
  status: 'missing' | 'detected' | 'confirmed';
  canEdit: boolean | null;
  canRebrand: boolean | null;
  canClaimAuthorship: boolean | null;
  canSellAsFinishedProduct: boolean | null;
  platformRestrictions: string[];
  rawTerms: string | null;
  confirmedAt: string | null;
}

export type FlagKind =
  | 'seller-branding'
  | 'url'
  | 'trademark'
  | 'copyright-notice'
  | 'license-missing'
  | 'scraped-source'
  | 'stripped-header-footer'
  | 'low-confidence'
  | 'ai-disclosure';

export interface IngestFlag {
  kind: FlagKind;
  severity: 'info' | 'warn' | 'block';
  message: string;
  pages?: number[];
  sample?: string;
}

export interface IngestReport {
  sourceFileName: string;
  pageCount: number;
  pagesProcessed: number;
  tocPages: number[];
  tocEntries: { title: string; page: number | null }[];
  strippedLines: { text: string; count: number }[];
  sectionCount: number;
  blockCounts: Partial<Record<BlockType, number>>;
  avgConfidence: number;
  flags: IngestFlag[];
  aiRefined: boolean;
  aiNotes: string[];
  durationMs: number;
}

export interface BackCoverCopy {
  headline: string;
  blurb: string;
  bullets: string[];
}

export interface ProductDocument {
  title: string;
  subtitle: string | null;
  productType: ProductType;
  deliverables: Deliverable[];
  backCover?: BackCoverCopy; // written by the Writer's rebrand pass
  titleOptions?: { title: string; subtitle: string }[];
}

// ---------- personas & writer ----------

export type PresetTone =
  | 'informative'
  | 'witty'
  | 'casual'
  | 'authoritative'
  | 'motivational'
  | 'story-driven'
  | 'conversational'
  | 'direct-response';

export const PRESET_TONES: { id: PresetTone; label: string; hint: string }[] = [
  { id: 'informative', label: 'Informative', hint: 'Clear, factual, explains the why' },
  { id: 'witty', label: 'Witty', hint: 'Dry humor, punchlines, light irreverence' },
  { id: 'casual', label: 'Casual', hint: 'Relaxed, plain words, contractions' },
  { id: 'authoritative', label: 'Authoritative', hint: 'Confident expert, decisive advice' },
  { id: 'motivational', label: 'Motivational', hint: 'Encouraging, momentum, you-can-do-this' },
  { id: 'story-driven', label: 'Story-driven', hint: 'Scenes and examples carry the points' },
  { id: 'conversational', label: 'Conversational', hint: 'Talks to the reader like a friend' },
  { id: 'direct-response', label: 'Direct-response', hint: 'Benefit-led, persuasive, clear calls to action' },
];

export interface Persona {
  id: string;
  name: string;
  description: string;
  inspiration?: { note: string; source: string };
  presets: PresetTone[];
  sliders: { formality: number; humor: number; sentenceLength: number; readingLevel: number; opinion: number };
  traits: Record<string, string>;
  signatureMoves: string[];
  bannedPhrases: string[];
  rules: string[];
  recipeFormat?: { headnote: string; steps: string; extras: string[] };
  examples?: PersonaExample[];
  builtIn?: boolean;
}

export interface PersonaExample {
  mode: string;
  source: unknown;
  rewrite: unknown;
}

export type ConvenienceMode = 'upgrade' | 'keep' | 'cut';

export interface WriterSettings {
  personaId: string;
  convenience: ConvenienceMode; // recipes built on canned soup / seasoning packets
  scope: 'all' | 'beef'; // 'beef' cuts recipes that aren't beef (keeps sauces/rubs/marinades made for steak)
  sectionIds?: string[]; // limit to these sections
  limit?: number; // sample run: first N content sections
  minTransformation: number; // 0..1 — share of the rewrite that must be new wording
}

export interface SectionWriteResult {
  sectionId: string;
  title: string;
  status: 'written' | 'flagged' | 'skipped' | 'cut' | 'failed';
  transformation: number | null; // 0..1
  bannedHits: string[];
  attempts: number;
  notes: string[];
}

export interface WriterReport {
  personaId: string;
  personaName: string;
  settings: WriterSettings;
  startedAt: string;
  finishedAt: string;
  sections: SectionWriteResult[];
  avgTransformation: number | null;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; calls: number };
}

export interface PublisherBrand {
  name: string;
  tagline: string;
  website: string;
  colors: { black: string; gold: string; white: string; muted: string; rule: string };
  font: string;
}

export type ProductStatus = 'ingesting' | 'ingested' | 'writing' | 'written' | 'rendering' | 'rendered' | 'failed';

export interface ProductSummary {
  id: string;
  title: string;
  productType: ProductType;
  status: ProductStatus;
  sourceFileName: string;
  licenseStatus: License['status'];
  renderFileKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductRecord extends ProductSummary {
  document: ProductDocument | null;
  draft: ProductDocument | null; // Writer output; rendered instead of the source when present
  writerReport: WriterReport | null;
  license: License;
  ingestReport: IngestReport | null;
  authorPenName: string | null;
  authorShortBio: string | null;
}

export interface JobRecord {
  id: string;
  productId: string | null;
  kind: 'ingest' | 'render' | 'write' | 'persona';
  result?: unknown;
  status: 'queued' | 'running' | 'done' | 'failed';
  progress: number;
  message: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export const emptyLicense = (): License => ({
  status: 'missing',
  canEdit: null,
  canRebrand: null,
  canClaimAuthorship: null,
  canSellAsFinishedProduct: null,
  platformRestrictions: [],
  rawTerms: null,
  confirmedAt: null,
});
