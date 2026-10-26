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
      meta?: { servings?: string; prepTime?: string; cookTime?: string };
      ingredients: string[];
      directions: string[];
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

export interface ProductDocument {
  title: string;
  subtitle: string | null;
  productType: ProductType;
  deliverables: Deliverable[];
}

export interface PublisherBrand {
  name: string;
  tagline: string;
  website: string;
  colors: { black: string; gold: string; white: string; muted: string; rule: string };
  font: string;
}

export type ProductStatus = 'ingesting' | 'ingested' | 'rendering' | 'rendered' | 'failed';

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
  license: License;
  ingestReport: IngestReport | null;
  authorPenName: string | null;
  authorShortBio: string | null;
}

export interface JobRecord {
  id: string;
  productId: string;
  kind: 'ingest' | 'render';
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
