// The book as it will ship: the draft (or source) minus sections the Clean-up step took out.
import type { ProductAnalysis, ProductDocument } from '../shared/types.js';

export function withoutExcluded(doc: ProductDocument, analysis: ProductAnalysis | null | undefined): ProductDocument {
  const ex = analysis?.excluded ?? {};
  if (!Object.keys(ex).length) return doc;
  return { ...doc, deliverables: doc.deliverables.map((d) => ({ ...d, sections: d.sections.filter((s) => !ex[s.id]) })) };
}

export function bookDoc(r: { draft: ProductDocument | null; document: ProductDocument | null; analysis: ProductAnalysis | null }): ProductDocument | null {
  const doc = r.draft ?? r.document;
  return doc ? withoutExcluded(doc, r.analysis) : null;
}
