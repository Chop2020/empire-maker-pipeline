import type { JobRecord, License, ProductRecord, ProductSummary } from '../../shared/types';

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
  storage: string;
  db: string;
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
  downloadUrl: (id: string, inline = false) => `/api/products/${id}/download${inline ? '?inline=1' : ''}`,
  sourceUrl: (id: string) => `/api/products/${id}/source`,
};
