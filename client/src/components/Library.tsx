import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProductSummary } from '../../../shared/types';
import { api } from '../api';
import { StatusBadge, TypeBadge, LicenseBadge } from './badges';

export function Library() {
  const [items, setItems] = useState<ProductSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api.products().then(setItems).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  const send = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    let lastId: string | null = null;
    for (const f of Array.from(files)) {
      setUploading(f.name);
      try {
        const r = await api.upload(f);
        lastId = r.product.id;
      } catch (e) {
        setError(`${f.name}: ${(e as Error).message}`);
      }
    }
    setUploading(null);
    load();
    if (files.length === 1 && lastId) window.location.hash = `#/p/${lastId}`;
  };

  return (
    <div className="library">
      <div className="lib-head">
        <div>
          <h1>Source library</h1>
          <p className="muted">Upload PLR PDFs. Ingest strips the old branding, recovers the structure and checks the rights before anything gets rewritten.</p>
        </div>
      </div>

      <label
        className={`drop${drag ? ' drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void send(e.dataTransfer.files);
        }}
      >
        <input ref={input} type="file" accept="application/pdf,.pdf" multiple onChange={(e) => void send(e.target.files)} />
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 16V4" />
          <path d="m6 10 6-6 6 6" />
          <path d="M4 20h16" />
        </svg>
        <span className="drop-title">{uploading ? `Uploading ${uploading}…` : 'Drop PLR PDFs here, or click to choose'}</span>
        <span className="muted small">PDF only for now · up to 250 MB each</span>
      </label>

      {error && <div className="alert error" role="alert">{error}</div>}

      {items && items.length === 0 && <p className="muted empty">No products yet. Your first upload starts the pipeline.</p>}

      {items && items.length > 0 && (
        <div className="table-wrap">
          <table className="list">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Status</th>
                <th>Rights</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <a href={`#/p/${p.id}`} className="title-link">
                      {p.title}
                    </a>
                    <div className="muted small">{p.sourceFileName}</div>
                  </td>
                  <td>
                    <TypeBadge type={p.productType} />
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td>
                    <LicenseBadge status={p.licenseStatus} />
                  </td>
                  <td className="muted small nowrap">{new Date(p.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
