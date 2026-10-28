import type { ImageRequest, JobRecord, License, Persona, PresetTone, ProductRecord, ProductSummary, WriterSettings } from '../../shared/types';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export interface Health {
  ok: boolean;
  chrome: boolean;
  ai: boolean;
  images: boolean;
  storage: string;
  db: string;
}

export interface WriteEstimate {
  sections: number;
  cut: number;
  outOfScope: number;
  convenienceRecipes: number;
  calls: number;
  cachedSystemTokens: number;
  inputTokens: number;
  outputTokens: number;
  usd: number | null;
  model: string;
  aiReady: boolean;
}

export interface ImagePlan {
  ready: boolean;
  provider: string;
  model: string;
  directorReady: boolean;
  recipes: { total: number; done: number };
  openers: { total: number; done: number };
  cover: boolean;
  heroUsd: number;
  pageUsd: number;
  spentUsd: number;
  usingDraft: boolean;
}

export const api = {
  health: () => req<Health>('/api/health'),
  products: () => req<ProductSummary[]>('/api/products'),
  product: (id: string) => req<ProductRecord>(`/api/products/${id}`),
  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return req<{ product: ProductRecord; job: JobRecord }>('/api/products', { method: 'POST', body: fd });
  },
  updateMeta: (id: string, body: { title?: string; subtitle?: string | null; authorPenName?: string | null; authorShortBio?: string | null }) =>
    req<ProductRecord>(`/api/products/${id}`, json('PATCH', body)),
  updateLicense: (id: string, body: Partial<License> & { confirm?: boolean }) =>
    req<ProductRecord>(`/api/products/${id}/license`, json('PATCH', body)),
  reingest: (id: string) => req<JobRecord>(`/api/products/${id}/reingest`, { method: 'POST' }),
  render: (id: string) => req<JobRecord>(`/api/products/${id}/render`, { method: 'POST' }),
  jobs: (id: string) => req<JobRecord[]>(`/api/products/${id}/jobs`),
  remove: (id: string) => req<void>(`/api/products/${id}`, { method: 'DELETE' }),
  estimateWrite: (id: string, body: Partial<WriterSettings>) => req<WriteEstimate>(`/api/products/${id}/write/estimate`, json('POST', body)),
  write: (id: string, body: Partial<WriterSettings>) => req<JobRecord>(`/api/products/${id}/write`, json('POST', body)),
  discardDraft: (id: string) => req<ProductRecord>(`/api/products/${id}/draft`, { method: 'DELETE' }),
  lockSection: (id: string, sid: string, locked: boolean) => req<ProductRecord>(`/api/products/${id}/sections/${sid}/lock`, json('PATCH', { locked })),
  cancelJob: (jobId: string) => req<{ ok: boolean }>(`/api/jobs/${jobId}/cancel`, { method: 'POST' }),
  job: (jobId: string) => req<JobRecord>(`/api/jobs/${jobId}`),
  personas: () => req<Persona[]>('/api/personas'),
  persona: (pid: string) => req<Persona>(`/api/personas/${pid}`),
  createPersona: (body: { name: string; presets: PresetTone[]; sliders: Persona['sliders']; baseId?: string }) => req<Persona>('/api/personas', json('POST', body)),
  updatePersona: (pid: string, body: Partial<Persona>) => req<Persona>(`/api/personas/${pid}`, json('PATCH', body)),
  duplicatePersona: (pid: string) => req<Persona>(`/api/personas/${pid}/duplicate`, { method: 'POST' }),
  deletePersona: (pid: string) => req<void>(`/api/personas/${pid}`, { method: 'DELETE' }),
  researchPersona: (body: { authorName?: string; samples?: string; notes?: string }) => req<JobRecord>('/api/personas/research', json('POST', body)),
  imagePlan: (id: string) => req<ImagePlan>(`/api/products/${id}/images/plan`),
  generateImages: (id: string, body: ImageRequest) => req<JobRecord>(`/api/products/${id}/images`, json('POST', body)),
  setImageStyle: (id: string, body: { presetId?: string; text?: string }) => req<ProductRecord>(`/api/products/${id}/images/style`, json('PATCH', body)),
  approveImage: (id: string, slot: string, approved: boolean) => req<ProductRecord>(`/api/products/${id}/images/${slot}`, json('PATCH', { approved })),
  removeImage: (id: string, slot: string) => req<ProductRecord>(`/api/products/${id}/images/${slot}`, { method: 'DELETE' }),
  imageUrl: (id: string, slot: string, v: number, full = false) => `/api/products/${id}/images/${slot}/file?v=${v}${full ? '&full=1' : ''}`,
  downloadUrl: (id: string, inline = false) => `/api/products/${id}/download${inline ? '?inline=1' : ''}`,
  sourceUrl: (id: string) => `/api/products/${id}/source`,
};
